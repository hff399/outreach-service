import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { join } from 'path';
import { supabase } from '../lib/supabase.js';
import { tgManager, wsHub } from '../index.js';
import type { SendMessageRequest } from '@shared/types/api.js';

// Convert URL path to filesystem path
function resolveMediaPath(urlPath: string): string {
  // /uploads/filename.ext -> ./uploads/filename.ext
  if (urlPath.startsWith('/uploads/')) {
    return join('./uploads', urlPath.replace('/uploads/', ''));
  }
  return urlPath;
}

const sendMessageSchema = z.object({
  lead_id: z.string().uuid(),
  account_id: z.string().uuid(),
  type: z.enum(['text', 'video', 'video_note', 'voice', 'photo', 'document']),
  content: z.string().optional(),
  media_url: z.string().optional(),
  reply_to_message_id: z.string().uuid().optional(),
});

export async function messagesRoutes(fastify: FastifyInstance) {
  // Get messages for a lead
  fastify.get(
    '/lead/:leadId',
    async (
      request: FastifyRequest<{
        Params: { leadId: string };
        Querystring: { limit?: string; before_id?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { leadId } = request.params;
      const { limit = '50', before_id } = request.query;

      let query = supabase
        .from('messages')
        .select('*')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(parseInt(limit, 10));

      if (before_id) {
        const { data: beforeMessage } = await supabase
          .from('messages')
          .select('created_at')
          .eq('id', before_id)
          .single();

        if (beforeMessage) {
          query = query.lt('created_at', beforeMessage.created_at);
        }
      }

      const { data: messages, error } = await query;

      if (error) {
        return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
      }

      // Return in chronological order
      return { success: true, data: messages?.reverse() || [] };
    }
  );

  // Send message
  fastify.post('/send', async (request: FastifyRequest<{ Body: SendMessageRequest }>, reply: FastifyReply) => {
    const parsed = sendMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() },
      });
    }

    const { lead_id, account_id, type, content, media_url, reply_to_message_id } = parsed.data;

    // Check if account is connected
    if (!tgManager.isConnected(account_id)) {
      return reply.status(400).send({
        success: false,
        error: { code: 'ACCOUNT_NOT_CONNECTED', message: 'Account is not connected' },
      });
    }

    // Get lead with access_hash
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('tg_user_id, custom_fields')
      .eq('id', lead_id)
      .single();

    if (leadError || !lead) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Lead not found' } });
    }

    const accessHash = (lead.custom_fields as Record<string, string> | null)?.tg_access_hash;

    // Create message record
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .insert({
        lead_id,
        account_id,
        direction: 'outgoing',
        type,
        content: type === 'text' ? content : null,
        media_url: type !== 'text' ? media_url : null,
        status: 'pending',
        replied_to_message_id: reply_to_message_id,
      })
      .select()
      .single();

    if (msgError) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: msgError.message } });
    }

    try {
      let tgMessage;

      switch (type) {
        case 'text':
          tgMessage = await tgManager.sendMessage(account_id, lead.tg_user_id, content!, accessHash);
          break;

        case 'video':
        case 'photo':
        case 'document':
          tgMessage = await tgManager.sendMedia(account_id, lead.tg_user_id, resolveMediaPath(media_url!), undefined, false, false, accessHash);
          break;

        case 'video_note':
          tgMessage = await tgManager.sendMedia(account_id, lead.tg_user_id, resolveMediaPath(media_url!), undefined, true, false, accessHash);
          break;

        case 'voice':
          tgMessage = await tgManager.sendMedia(account_id, lead.tg_user_id, resolveMediaPath(media_url!), undefined, false, true, accessHash);
          break;
      }

      // Update message with TG message ID
      const { data: updatedMessage } = await supabase
        .from('messages')
        .update({
          tg_message_id: tgMessage?.id?.toString(),
          status: 'sent',
          sent_at: new Date().toISOString(),
        })
        .eq('id', message.id)
        .select()
        .single();

      // Update lead last message time
      await supabase
        .from('leads')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', lead_id);

      // Mark messages as read in Telegram after sending
      try {
        await tgManager.markAsRead(account_id, lead.tg_user_id, accessHash);
      } catch {
        // Ignore errors - not critical
      }

      // Emit WebSocket event
      wsHub.emitMessageSent(lead_id, message.id);

      return { success: true, data: updatedMessage };
    } catch (error) {
      // Update message status to failed
      await supabase.from('messages').update({ status: 'failed' }).eq('id', message.id);

      return reply.status(500).send({
        success: false,
        error: { code: 'SEND_FAILED', message: (error as Error).message },
      });
    }
  });

  // Mark message as read
  fastify.post(
    '/:id/read',
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params;

      const { data: message, error } = await supabase
        .from('messages')
        .update({
          status: 'read',
          read_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
      }

      return { success: true, data: message };
    }
  );

  // Get unread count
  fastify.get('/unread/count', async (_request: FastifyRequest, reply: FastifyReply) => {
    const { count, error } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('direction', 'incoming')
      .neq('status', 'read');

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return { success: true, data: { unread: count || 0 } };
  });

  // Mark all lead messages as read
  fastify.post(
    '/lead/:leadId/read-all',
    async (request: FastifyRequest<{ Params: { leadId: string } }>, reply: FastifyReply) => {
      const { leadId } = request.params;

      // Get lead with account info and access_hash
      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .select('tg_user_id, assigned_account_id, custom_fields')
        .eq('id', leadId)
        .single();

      if (leadError || !lead) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Lead not found' } });
      }

      const accessHash = (lead.custom_fields as Record<string, string> | null)?.tg_access_hash;

      // Mark all incoming messages as read in DB
      const { error } = await supabase
        .from('messages')
        .update({
          status: 'read',
          read_at: new Date().toISOString(),
        })
        .eq('lead_id', leadId)
        .eq('direction', 'incoming')
        .neq('status', 'read');

      if (error) {
        return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
      }

      // Also mark as read in Telegram if account is connected
      if (lead.assigned_account_id && tgManager.isConnected(lead.assigned_account_id)) {
        try {
          await tgManager.markAsRead(lead.assigned_account_id, lead.tg_user_id, accessHash);
        } catch {
          // Ignore errors - not critical
        }
      }

      return { success: true, data: null };
    }
  );

  // Send typing status
  fastify.post(
    '/lead/:leadId/typing',
    async (request: FastifyRequest<{ Params: { leadId: string } }>, reply: FastifyReply) => {
      const { leadId } = request.params;

      // Get lead with account info and access_hash
      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .select('tg_user_id, assigned_account_id, custom_fields')
        .eq('id', leadId)
        .single();

      if (leadError || !lead) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Lead not found' } });
      }

      const accessHash = (lead.custom_fields as Record<string, string> | null)?.tg_access_hash;

      if (!lead.assigned_account_id) {
        return reply.status(400).send({
          success: false,
          error: { code: 'NO_ACCOUNT', message: 'Lead has no assigned account' },
        });
      }

      if (!tgManager.isConnected(lead.assigned_account_id)) {
        return reply.status(400).send({
          success: false,
          error: { code: 'ACCOUNT_NOT_CONNECTED', message: 'Account is not connected' },
        });
      }

      await tgManager.sendTypingStatus(lead.assigned_account_id, lead.tg_user_id, accessHash);
      return { success: true, data: null };
    }
  );
}
