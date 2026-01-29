import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import type { ImportGroupsRequest, UpdateGroupRequest } from '@outreach/shared/types/api.js';

const importGroupsSchema = z.object({
  groups: z.array(z.object({
    tg_id: z.string().min(1),
    username: z.string().optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    member_count: z.number().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })),
});

export async function groupsRoutes(fastify: FastifyInstance) {
  // Get all groups
  fastify.get(
    '/',
    async (
      request: FastifyRequest<{
        Querystring: {
          category?: string;
          search?: string;
          min_members?: string;
          max_members?: string;
          page?: string;
          page_size?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      const {
        category,
        search,
        min_members,
        max_members,
        page = '1',
        page_size = '50',
      } = request.query;

      const pageNum = parseInt(page, 10);
      const pageSizeNum = parseInt(page_size, 10);
      const offset = (pageNum - 1) * pageSizeNum;

      let query = supabase.from('tg_groups').select('*', { count: 'exact' });

      if (category && category !== 'undefined') {
        query = query.eq('category', category);
      }

      if (search && search !== 'undefined') {
        query = query.or(`title.ilike.%${search}%,username.ilike.%${search}%,description.ilike.%${search}%`);
      }

      if (min_members) {
        query = query.gte('member_count', parseInt(min_members, 10));
      }

      if (max_members) {
        query = query.lte('member_count', parseInt(max_members, 10));
      }

      const { data: groups, error, count } = await query
        .order('member_count', { ascending: false, nullsFirst: false })
        .range(offset, offset + pageSizeNum - 1);

      if (error) {
        return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
      }

      return {
        success: true,
        data: {
          items: groups,
          total: count || 0,
          page: pageNum,
          pageSize: pageSizeNum,
          totalPages: Math.ceil((count || 0) / pageSizeNum),
        },
      };
    }
  );

  // Get single group
  fastify.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { data: group, error } = await supabase.from('tg_groups').select('*').eq('id', id).single();

    if (error || !group) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Group not found' } });
    }

    return { success: true, data: group };
  });

  // Import groups
  fastify.post('/import', async (request: FastifyRequest<{ Body: ImportGroupsRequest }>, reply: FastifyReply) => {
    const parsed = importGroupsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() },
      });
    }

    const groupsToInsert = parsed.data.groups.map((group) => ({
      tg_id: group.tg_id,
      username: group.username,
      title: group.title,
      description: group.description,
      member_count: group.member_count,
      category: group.category,
      tags: group.tags || [],
    }));

    const { data: groups, error } = await supabase
      .from('tg_groups')
      .upsert(groupsToInsert, {
        onConflict: 'tg_id',
        ignoreDuplicates: false,
      })
      .select();

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return reply.status(201).send({
      success: true,
      data: {
        imported: groups?.length || 0,
        groups,
      },
    });
  });

  // Update group
  fastify.patch(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string }; Body: UpdateGroupRequest }>, reply: FastifyReply) => {
      const { id } = request.params;

      const { data: group, error } = await supabase
        .from('tg_groups')
        .update(request.body)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
      }

      return { success: true, data: group };
    }
  );

  // Delete group
  fastify.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { error } = await supabase.from('tg_groups').delete().eq('id', id);

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return { success: true, data: null };
  });

  // Get categories
  fastify.get('/meta/categories', async (_request: FastifyRequest, reply: FastifyReply) => {
    const { data, error } = await supabase
      .from('tg_groups')
      .select('category')
      .not('category', 'is', null);

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    const categories = [...new Set(data?.map((g) => g.category).filter(Boolean))];

    return { success: true, data: categories };
  });

  // Bulk delete
  fastify.post(
    '/bulk-delete',
    async (request: FastifyRequest<{ Body: { ids: string[] } }>, reply: FastifyReply) => {
      const { ids } = request.body;

      const { error } = await supabase.from('tg_groups').delete().in('id', ids);

      if (error) {
        return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
      }

      return { success: true, data: { deleted: ids.length } };
    }
  );

  // Bulk update category
  fastify.post(
    '/bulk-update',
    async (
      request: FastifyRequest<{ Body: { ids: string[]; category?: string; tags?: string[] } }>,
      reply: FastifyReply
    ) => {
      const { ids, ...updates } = request.body;

      const { error } = await supabase.from('tg_groups').update(updates).in('id', ids);

      if (error) {
        return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
      }

      return { success: true, data: { updated: ids.length } };
    }
  );
}
