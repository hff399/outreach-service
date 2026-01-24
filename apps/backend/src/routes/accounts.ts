import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { tgManager } from '../index.js';
import type { CreateAccountRequest, UpdateAccountRequest } from '@shared/types/api.js';

const createAccountSchema = z.object({
  phone: z.string().min(10),
  proxy_config: z.object({
    type: z.enum(['socks5', 'http', 'mtproto']),
    host: z.string(),
    port: z.number(),
    username: z.string().optional(),
    password: z.string().optional(),
  }).optional(),
  daily_message_limit: z.number().min(1).max(500).optional(),
});

const authCodeSchema = z.object({
  code: z.string().min(4),
  phone_code_hash: z.string(),
  password: z.string().optional(),
});

export async function accountsRoutes(fastify: FastifyInstance) {
  // Get all accounts
  fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    const { data: accounts, error } = await supabase
      .from('tg_accounts')
      .select('id, phone, username, first_name, last_name, status, daily_message_limit, messages_sent_today, last_active_at, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    // Add connection status
    const accountsWithStatus = accounts?.map((account) => ({
      ...account,
      is_connected: tgManager.isConnected(account.id),
    }));

    return { success: true, data: accountsWithStatus };
  });

  // Get single account
  fastify.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { data: account, error } = await supabase
      .from('tg_accounts')
      .select('id, phone, username, first_name, last_name, status, proxy_config, daily_message_limit, messages_sent_today, last_active_at, created_at')
      .eq('id', id)
      .single();

    if (error || !account) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } });
    }

    return {
      success: true,
      data: {
        ...account,
        is_connected: tgManager.isConnected(account.id),
      },
    };
  });

  // Create new account
  fastify.post('/', async (request: FastifyRequest<{ Body: CreateAccountRequest }>, reply: FastifyReply) => {
    const parsed = createAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() },
      });
    }

    const { phone, proxy_config, daily_message_limit } = parsed.data;

    // Check if account already exists
    const { data: existing } = await supabase
      .from('tg_accounts')
      .select('id')
      .eq('phone', phone)
      .single();

    if (existing) {
      return reply.status(409).send({
        success: false,
        error: { code: 'ALREADY_EXISTS', message: 'Account with this phone already exists' },
      });
    }

    // Create account
    const { data: account, error } = await supabase
      .from('tg_accounts')
      .insert({
        phone,
        proxy_config,
        daily_message_limit: daily_message_limit || 50,
        status: 'auth_required',
      })
      .select()
      .single();

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return reply.status(201).send({ success: true, data: account });
  });

  // Start authentication
  fastify.post('/:id/auth/start', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { data: account, error } = await supabase
      .from('tg_accounts')
      .select('phone')
      .eq('id', id)
      .single();

    if (error || !account) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } });
    }

    try {
      const result = await tgManager.startAuth(id, account.phone);
      return { success: true, data: result };
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: { code: 'AUTH_ERROR', message: (err as Error).message },
      });
    }
  });

  // Complete authentication
  fastify.post(
    '/:id/auth/complete',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { code: string; phone_code_hash: string; password?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;

      const parsed = authCodeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
        });
      }

      const { data: account } = await supabase
        .from('tg_accounts')
        .select('phone')
        .eq('id', id)
        .single();

      if (!account) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } });
      }

      try {
        await tgManager.completeAuth(
          id,
          account.phone,
          parsed.data.code,
          parsed.data.phone_code_hash,
          parsed.data.password
        );

        return { success: true, data: { authenticated: true } };
      } catch (err) {
        const message = (err as Error).message;

        if (message === '2FA_REQUIRED') {
          return reply.status(400).send({
            success: false,
            error: { code: '2FA_REQUIRED', message: 'Two-factor authentication required' },
          });
        }

        return reply.status(500).send({
          success: false,
          error: { code: 'AUTH_ERROR', message },
        });
      }
    }
  );

  // Update account
  fastify.patch(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string }; Body: UpdateAccountRequest }>, reply: FastifyReply) => {
      const { id } = request.params;
      const updates = request.body;

      const { data: account, error } = await supabase
        .from('tg_accounts')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
      }

      return { success: true, data: account };
    }
  );

  // Delete account
  fastify.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    // Disconnect first
    await tgManager.disconnectAccount(id);

    const { error } = await supabase.from('tg_accounts').delete().eq('id', id);

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return { success: true, data: null };
  });

  // Health check for all accounts
  fastify.get('/health/all', async () => {
    const health = await tgManager.getHealthStatus();
    return { success: true, data: { accounts: health } };
  });

  // Reconnect account
  fastify.post('/:id/reconnect', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { data: account, error } = await supabase.from('tg_accounts').select('*').eq('id', id).single();

    if (error || !account) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Account not found' } });
    }

    if (!account.session_string) {
      return reply.status(400).send({
        success: false,
        error: { code: 'NO_SESSION', message: 'Account has no session, authentication required' },
      });
    }

    await tgManager.disconnectAccount(id);
    const connected = await tgManager.connectAccount(account as never);

    return { success: true, data: { connected } };
  });
}
