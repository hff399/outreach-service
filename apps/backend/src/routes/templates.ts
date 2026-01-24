import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { parseTemplateVariables } from '@shared/utils/index.js';
import type { CreateTemplateRequest, UpdateTemplateRequest } from '@shared/types/api.js';

const createTemplateSchema = z.object({
  name: z.string().min(1),
  content: z.string().min(1),
});

export async function templatesRoutes(fastify: FastifyInstance) {
  // Get all templates
  fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
    const { data: templates, error } = await supabase
      .from('message_templates')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return { success: true, data: templates };
  });

  // Get single template
  fastify.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { data: template, error } = await supabase
      .from('message_templates')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !template) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found' } });
    }

    return { success: true, data: template };
  });

  // Create template
  fastify.post('/', async (request: FastifyRequest<{ Body: CreateTemplateRequest }>, reply: FastifyReply) => {
    const parsed = createTemplateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() },
      });
    }

    const variables = parseTemplateVariables(parsed.data.content);

    const { data: template, error } = await supabase
      .from('message_templates')
      .insert({
        ...parsed.data,
        variables,
      })
      .select()
      .single();

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return reply.status(201).send({ success: true, data: template });
  });

  // Update template
  fastify.patch(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string }; Body: UpdateTemplateRequest }>, reply: FastifyReply) => {
      const { id } = request.params;
      const updates = request.body;

      // Re-parse variables if content changed
      if (updates.content) {
        (updates as { variables?: string[] }).variables = parseTemplateVariables(updates.content);
      }

      const { data: template, error } = await supabase
        .from('message_templates')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
      }

      return { success: true, data: template };
    }
  );

  // Delete template
  fastify.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { error } = await supabase.from('message_templates').delete().eq('id', id);

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return { success: true, data: null };
  });

  // Preview template
  fastify.post(
    '/:id/preview',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { variables: Record<string, string> } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { variables } = request.body;

      const { data: template, error } = await supabase
        .from('message_templates')
        .select('content')
        .eq('id', id)
        .single();

      if (error || !template) {
        return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found' } });
      }

      // Apply variables
      let preview = template.content;
      for (const [key, value] of Object.entries(variables)) {
        preview = preview.replace(new RegExp(`{{${key}}}`, 'g'), value);
      }

      return { success: true, data: { preview } };
    }
  );
}
