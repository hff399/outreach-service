import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import type { CreateLeadRequest, UpdateLeadRequest, LeadFilters } from '@outreach/shared/types/api.js';

const createLeadSchema = z.object({
  tg_user_id: z.string().min(1),
  username: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  phone: z.string().optional(),
  status_id: z.string().uuid().optional(),
  source_campaign_id: z.string().uuid().optional(),
  source_group_id: z.string().uuid().optional(),
  assigned_account_id: z.string().uuid().optional(),
  notes: z.string().optional(),
  custom_fields: z.record(z.unknown()).optional(),
});

export async function leadsRoutes(fastify: FastifyInstance) {
  // Get all leads with filtering
  fastify.get(
    '/',
    async (
      request: FastifyRequest<{
        Querystring: LeadFilters & { page?: string; page_size?: string; needs_response?: string };
      }>,
      reply: FastifyReply
    ) => {
      const {
        status_ids,
        campaign_ids,
        account_ids,
        search,
        date_from,
        date_to,
        needs_response,
        page = '1',
        page_size = '50',
      } = request.query;

      const pageNum = parseInt(page, 10);
      const pageSizeNum = parseInt(page_size, 10);
      const offset = (pageNum - 1) * pageSizeNum;

      // If filtering by needs_response, we need to check the last message direction
      if (needs_response === 'true') {
        // Get leads with their last message direction
        const { data: leadsWithMessages } = await supabase
          .from('messages')
          .select('lead_id, direction, created_at')
          .order('created_at', { ascending: false });

        // Group by lead_id and get the last message
        const lastMessageByLead = new Map<string, string>();
        for (const msg of leadsWithMessages || []) {
          if (!lastMessageByLead.has(msg.lead_id)) {
            lastMessageByLead.set(msg.lead_id, msg.direction);
          }
        }

        // Get leads where last message is incoming
        const unrespondedIds = Array.from(lastMessageByLead.entries())
          .filter(([, direction]) => direction === 'incoming')
          .map(([leadId]) => leadId);

        if (unrespondedIds.length === 0) {
          return {
            success: true,
            data: {
              items: [],
              total: 0,
              page: pageNum,
              pageSize: pageSizeNum,
              totalPages: 0,
            },
          };
        }

        let query = supabase
          .from('leads')
          .select('*, lead_statuses(id, name, color), tg_accounts(id, phone, username)', { count: 'exact' })
          .in('id', unrespondedIds);

        // Apply other filters
        if (status_ids && status_ids !== 'undefined') {
          const ids = Array.isArray(status_ids) ? status_ids : [status_ids];
          query = query.in('status_id', ids.filter(id => id !== 'undefined'));
        }
        if (account_ids && account_ids !== 'undefined') {
          const ids = Array.isArray(account_ids) ? account_ids : [account_ids];
          query = query.in('assigned_account_id', ids.filter(id => id !== 'undefined'));
        }
        if (search && search !== 'undefined') {
          query = query.or(`username.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
        }

        const { data: leads, error, count } = await query
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .range(offset, offset + pageSizeNum - 1);

        if (error) {
          return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
        }

        return {
          success: true,
          data: {
            items: leads,
            total: count || 0,
            page: pageNum,
            pageSize: pageSizeNum,
            totalPages: Math.ceil((count || 0) / pageSizeNum),
          },
        };
      }

      let query = supabase
        .from('leads')
        .select('*, lead_statuses(id, name, color), tg_accounts(id, phone, username)', { count: 'exact' });

      // Filter out 'undefined' string values
      if (status_ids && status_ids !== 'undefined') {
        const ids = Array.isArray(status_ids) ? status_ids : [status_ids];
        query = query.in('status_id', ids.filter(id => id !== 'undefined'));
      }

      if (campaign_ids && campaign_ids !== 'undefined') {
        const ids = Array.isArray(campaign_ids) ? campaign_ids : [campaign_ids];
        query = query.in('source_campaign_id', ids.filter(id => id !== 'undefined'));
      }

      if (account_ids && account_ids !== 'undefined') {
        const ids = Array.isArray(account_ids) ? account_ids : [account_ids];
        query = query.in('assigned_account_id', ids.filter(id => id !== 'undefined'));
      }

      if (search && search !== 'undefined') {
        query = query.or(
          `username.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`
        );
      }

      if (date_from && date_from !== 'undefined') {
        query = query.gte('created_at', date_from);
      }

      if (date_to && date_to !== 'undefined') {
        query = query.lte('created_at', date_to);
      }

      const { data: leads, error, count } = await query
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .range(offset, offset + pageSizeNum - 1);

      if (error) {
        return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
      }

      return {
        success: true,
        data: {
          items: leads,
          total: count || 0,
          page: pageNum,
          pageSize: pageSizeNum,
          totalPages: Math.ceil((count || 0) / pageSizeNum),
        },
      };
    }
  );

  // Get single lead with messages
  fastify.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { data: lead, error } = await supabase
      .from('leads')
      .select(`
        *,
        lead_statuses(id, name, color),
        tg_accounts(id, phone, username, first_name, last_name),
        campaigns:source_campaign_id(id, name),
        tg_groups:source_group_id(id, title, username)
      `)
      .eq('id', id)
      .single();

    if (error || !lead) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Lead not found' } });
    }

    return { success: true, data: lead };
  });

  // Create lead
  fastify.post('/', async (request: FastifyRequest<{ Body: CreateLeadRequest }>, reply: FastifyReply) => {
    const parsed = createLeadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() },
      });
    }

    // Get default status if not provided
    let statusId = parsed.data.status_id;
    if (!statusId) {
      const { data: defaultStatus } = await supabase
        .from('lead_statuses')
        .select('id')
        .eq('is_default', true)
        .single();
      statusId = defaultStatus?.id;
    }

    const { data: lead, error } = await supabase
      .from('leads')
      .insert({
        ...parsed.data,
        status_id: statusId!,
        custom_fields: parsed.data.custom_fields || {},
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return reply.status(409).send({
          success: false,
          error: { code: 'ALREADY_EXISTS', message: 'Lead with this TG user ID already exists' },
        });
      }
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return reply.status(201).send({ success: true, data: lead });
  });

  // Update lead
  fastify.patch(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string }; Body: UpdateLeadRequest }>, reply: FastifyReply) => {
      const { id } = request.params;

      const { data: lead, error } = await supabase
        .from('leads')
        .update(request.body)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
      }

      return { success: true, data: lead };
    }
  );

  // Update lead status
  fastify.patch(
    '/:id/status',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { status_id: string } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { status_id } = request.body;

      const { data: lead, error } = await supabase
        .from('leads')
        .update({ status_id })
        .eq('id', id)
        .select('*, lead_statuses(id, name, color)')
        .single();

      if (error) {
        return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
      }

      return { success: true, data: lead };
    }
  );

  // Delete lead
  fastify.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { error } = await supabase.from('leads').delete().eq('id', id);

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return { success: true, data: null };
  });

  // Get lead statistics
  fastify.get('/stats/overview', async (_request: FastifyRequest, reply: FastifyReply) => {
    const { data: statusCounts, error } = await supabase
      .from('leads')
      .select('status_id, lead_statuses(name, color)')
      .order('status_id');

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    // Group by status
    const stats: Record<string, { name: string; color: string; count: number }> = {};
    for (const lead of statusCounts || []) {
      const statusId = lead.status_id;
      if (!stats[statusId]) {
        const status = lead.lead_statuses as { name: string; color: string } | null;
        stats[statusId] = {
          name: status?.name || 'Unknown',
          color: status?.color || '#6B7280',
          count: 0,
        };
      }
      stats[statusId].count++;
    }

    const { count: totalLeads } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true });

    const { count: newToday } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', new Date().toISOString().split('T')[0]);

    // Count unresponded leads (last message is incoming)
    const { data: leadsWithMessages } = await supabase
      .from('messages')
      .select('lead_id, direction, created_at')
      .order('created_at', { ascending: false });

    const lastMessageByLead = new Map<string, string>();
    for (const msg of leadsWithMessages || []) {
      if (!lastMessageByLead.has(msg.lead_id)) {
        lastMessageByLead.set(msg.lead_id, msg.direction);
      }
    }

    const unrespondedCount = Array.from(lastMessageByLead.values())
      .filter(direction => direction === 'incoming').length;

    return {
      success: true,
      data: {
        total: totalLeads || 0,
        new_today: newToday || 0,
        unresponded: unrespondedCount,
        by_status: Object.values(stats),
      },
    };
  });
}
