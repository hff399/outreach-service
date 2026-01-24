import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import type { CreateLeadStatusRequest, UpdateLeadStatusRequest } from '@shared/types/api.js';

const createStatusSchema = z.object({
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  order: z.number().optional(),
  is_default: z.boolean().optional(),
  is_final: z.boolean().optional(),
});

export async function statusesRoutes(fastify: FastifyInstance) {
  // Get all statuses
  fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    const { data: statuses, error } = await supabase
      .from('lead_statuses')
      .select('*')
      .order('order', { ascending: true });

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return { success: true, data: statuses };
  });

  // Get single status
  fastify.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { data: status, error } = await supabase
      .from('lead_statuses')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !status) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Status not found' } });
    }

    return { success: true, data: status };
  });

  // Create status
  fastify.post('/', async (request: FastifyRequest<{ Body: CreateLeadStatusRequest }>, reply: FastifyReply) => {
    const parsed = createStatusSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() },
      });
    }

    // Get max order
    const { data: maxOrder } = await supabase
      .from('lead_statuses')
      .select('order')
      .order('order', { ascending: false })
      .limit(1)
      .single();

    const order = parsed.data.order ?? ((maxOrder?.order ?? 0) + 1);

    // If setting as default, unset other defaults
    if (parsed.data.is_default) {
      await supabase.from('lead_statuses').update({ is_default: false }).eq('is_default', true);
    }

    const { data: status, error } = await supabase
      .from('lead_statuses')
      .insert({
        ...parsed.data,
        order,
      })
      .select()
      .single();

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return reply.status(201).send({ success: true, data: status });
  });

  // Update status
  fastify.patch(
    '/:id',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateLeadStatusRequest }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const updates = request.body;

      // If setting as default, unset other defaults
      if (updates.is_default) {
        await supabase.from('lead_statuses').update({ is_default: false }).eq('is_default', true);
      }

      const { data: status, error } = await supabase
        .from('lead_statuses')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
      }

      return { success: true, data: status };
    }
  );

  // Delete status
  fastify.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    // Check if status is in use
    const { count } = await supabase
      .from('leads')
      .select('*', { count: 'exact', head: true })
      .eq('status_id', id);

    if (count && count > 0) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IN_USE', message: `Status is used by ${count} leads` },
      });
    }

    // Check if it's the default status
    const { data: status } = await supabase
      .from('lead_statuses')
      .select('is_default')
      .eq('id', id)
      .single();

    if (status?.is_default) {
      return reply.status(400).send({
        success: false,
        error: { code: 'IS_DEFAULT', message: 'Cannot delete default status' },
      });
    }

    const { error } = await supabase.from('lead_statuses').delete().eq('id', id);

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return { success: true, data: null };
  });

  // Reorder statuses
  fastify.post(
    '/reorder',
    async (request: FastifyRequest<{ Body: { order: string[] } }>, reply: FastifyReply) => {
      const { order } = request.body;

      const updates = order.map((id, index) => ({
        id,
        order: index,
      }));

      for (const update of updates) {
        await supabase.from('lead_statuses').update({ order: update.order }).eq('id', update.id);
      }

      return { success: true, data: null };
    }
  );
}
