import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import type { CreateSequenceRequest, UpdateSequenceRequest } from '@shared/types/api.js';

const stepConditionSchema = z.object({
  type: z.enum(['no_reply', 'replied', 'keyword_match', 'status_is', 'has_tag']),
  value: z.string().optional(),
  timeout_minutes: z.number().optional(),
});

const stepSchema = z.object({
  id: z.string().uuid().optional(),
  order: z.number().min(0),
  type: z.enum(['message', 'status_change', 'reminder', 'wait', 'branch', 'tag', 'assign', 'webhook']),
  delay_minutes: z.number().min(0).default(0),
  conditions: z.array(stepConditionSchema).optional(),

  // For 'message' type
  message_type: z.enum(['text', 'video', 'video_note', 'voice', 'photo', 'document']).optional(),
  content: z.string().optional(),

  // For 'status_change' type
  status_id: z.string().uuid().optional(),

  // For 'reminder' type
  reminder: z.object({
    title: z.string(),
    due_minutes: z.number().min(1),
    priority: z.enum(['low', 'medium', 'high']).optional(),
  }).optional(),

  // For 'wait' type
  wait_condition: z.object({
    type: z.enum(['reply', 'no_reply', 'time']),
    timeout_minutes: z.number().optional(),
  }).optional(),

  // For 'branch' type
  branches: z.array(z.object({
    condition: stepConditionSchema,
    next_step_id: z.string().uuid(),
  })).optional(),
  default_next_step_id: z.string().uuid().optional(),

  // For 'tag' type
  tags_to_add: z.array(z.string()).optional(),
  tags_to_remove: z.array(z.string()).optional(),

  // For 'assign' type
  assign_to_account_id: z.string().uuid().optional(),

  // For 'webhook' type
  webhook_url: z.string().url().optional(),
  webhook_method: z.enum(['GET', 'POST']).optional(),
});

const triggerSchema = z.object({
  type: z.enum([
    'new_message',      // First message from lead
    'keyword',          // Message contains keywords
    'regex',            // Message matches regex
    'any',              // Any incoming message
    'no_reply',         // Lead hasn't replied in X time
    'no_response',      // We haven't responded in X time (follow-up)
    'status_change',    // Lead status changed
    'scheduled',        // Time-based trigger (e.g., daily at 9am)
  ]),
  keywords: z.array(z.string()).optional(),
  regex_pattern: z.string().optional(),
  source_campaign_ids: z.array(z.string().uuid()).optional(),
  // For time-based triggers
  timeout_minutes: z.number().optional(),         // For no_reply/no_response
  from_status_id: z.string().uuid().optional(),   // For status_change trigger
  to_status_id: z.string().uuid().optional(),     // For status_change trigger
  schedule_cron: z.string().optional(),           // For scheduled triggers
  // Conditions
  conditions: z.array(z.object({
    field: z.enum(['status', 'tag', 'has_messages', 'last_message_direction', 'custom_field']),
    operator: z.enum(['equals', 'not_equals', 'contains', 'not_contains', 'greater_than', 'less_than', 'is_empty', 'is_not_empty']),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    custom_field_key: z.string().optional(),
  })).optional(),
});

const createSequenceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  trigger: triggerSchema,
  steps: z.array(stepSchema).min(1),
  assigned_accounts: z.array(z.string().uuid()).optional(),
});

export async function sequencesRoutes(fastify: FastifyInstance) {
  // Get all sequences
  fastify.get('/', async (request: FastifyRequest<{ Querystring: { status?: string } }>, reply: FastifyReply) => {
    let query = supabase
      .from('sequences')
      .select('*')
      .order('created_at', { ascending: false });

    if (request.query.status) {
      query = query.eq('status', request.query.status);
    }

    const { data: sequences, error } = await query;

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return { success: true, data: sequences };
  });

  // Get single sequence
  fastify.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { data: sequence, error } = await supabase
      .from('sequences')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !sequence) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Sequence not found' } });
    }

    // Get enrollment stats
    const { count: activeEnrollments } = await supabase
      .from('sequence_enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('sequence_id', id)
      .eq('status', 'active');

    const { count: completedEnrollments } = await supabase
      .from('sequence_enrollments')
      .select('*', { count: 'exact', head: true })
      .eq('sequence_id', id)
      .eq('status', 'completed');

    return {
      success: true,
      data: {
        ...sequence,
        stats: {
          active_enrollments: activeEnrollments || 0,
          completed_enrollments: completedEnrollments || 0,
        },
      },
    };
  });

  // Create sequence
  fastify.post('/', async (request: FastifyRequest<{ Body: CreateSequenceRequest }>, reply: FastifyReply) => {
    const parsed = createSequenceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() },
      });
    }

    // Add IDs to steps
    const stepsWithIds = parsed.data.steps.map((step, index) => ({
      ...step,
      id: crypto.randomUUID(),
      order: index,
    }));

    const { data: sequence, error } = await supabase
      .from('sequences')
      .insert({
        ...parsed.data,
        steps: stepsWithIds,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return reply.status(201).send({ success: true, data: sequence });
  });

  // Update sequence
  fastify.patch(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string }; Body: UpdateSequenceRequest }>, reply: FastifyReply) => {
      const { id } = request.params;
      const updates = request.body;

      // If updating steps, add IDs
      if (updates.steps) {
        updates.steps = updates.steps.map((step, index) => ({
          ...step,
          id: (step as { id?: string }).id || crypto.randomUUID(),
          order: index,
        }));
      }

      const { data: sequence, error } = await supabase
        .from('sequences')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
      }

      return { success: true, data: sequence };
    }
  );

  // Delete sequence
  fastify.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { error } = await supabase.from('sequences').delete().eq('id', id);

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return { success: true, data: null };
  });

  // Pause sequence
  fastify.post('/:id/pause', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { data: sequence, error } = await supabase
      .from('sequences')
      .update({ status: 'paused' })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return { success: true, data: sequence };
  });

  // Activate sequence
  fastify.post('/:id/activate', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { data: sequence, error } = await supabase
      .from('sequences')
      .update({ status: 'active' })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return { success: true, data: sequence };
  });

  // Get sequence enrollments
  fastify.get('/:id/enrollments', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { data: enrollments, error } = await supabase
      .from('sequence_enrollments')
      .select('*, leads(id, username, first_name, last_name)')
      .eq('sequence_id', id)
      .order('started_at', { ascending: false });

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return { success: true, data: enrollments };
  });
}
