import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { jobScheduler } from '../index.js';
import type { CreateCampaignRequest, UpdateCampaignRequest } from '@outreach/shared/types/api.js';

const scheduleConfigSchema = z.object({
  type: z.enum(['immediate']).default('immediate'),
  min_delay_seconds: z.number().min(10).default(180),
  max_delay_seconds: z.number().min(10).default(480),
  randomize_delay: z.boolean().default(true),
  account_rotation: z.enum(['round_robin', 'random', 'least_used']).default('round_robin'),
});

const createCampaignSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  message_template_id: z.string().uuid().optional(),
  custom_message: z.string().optional(),
  schedule_config: scheduleConfigSchema,
  group_filter: z.object({
    include_group_ids: z.array(z.string().uuid()).optional(),
    exclude_group_ids: z.array(z.string().uuid()).optional(),
    min_members: z.number().optional(),
    max_members: z.number().optional(),
    keywords: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
  }).optional(),
  assigned_accounts: z.array(z.string().uuid()).optional(),
});

export async function campaignsRoutes(fastify: FastifyInstance) {
  // Get all campaigns
  fastify.get('/', async (request: FastifyRequest<{ Querystring: { status?: string } }>, reply: FastifyReply) => {
    let query = supabase
      .from('campaigns')
      .select('*, message_templates(id, name)')
      .order('created_at', { ascending: false });

    if (request.query.status) {
      query = query.eq('status', request.query.status);
    }

    const { data: campaigns, error } = await query;

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    // Get actual group counts from campaign_groups table
    const campaignsWithCounts = await Promise.all(
      (campaigns || []).map(async (campaign) => {
        const { count: totalGroups } = await supabase
          .from('campaign_groups')
          .select('*', { count: 'exact', head: true })
          .eq('campaign_id', campaign.id);

        const { count: sentGroups } = await supabase
          .from('campaign_groups')
          .select('*', { count: 'exact', head: true })
          .eq('campaign_id', campaign.id)
          .eq('status', 'sent');

        return {
          ...campaign,
          stats: {
            ...campaign.stats,
            total_groups: totalGroups || 0,
            messages_sent: sentGroups || 0,
          },
        };
      })
    );

    return { success: true, data: campaignsWithCounts };
  });

  // Get single campaign
  fastify.get('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .select('*, message_templates(*)')
      .eq('id', id)
      .single();

    if (error || !campaign) {
      return reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Campaign not found' } });
    }

    // Get group stats
    const { count: totalGroups } = await supabase
      .from('campaign_groups')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', id);

    const { count: sentGroups } = await supabase
      .from('campaign_groups')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', id)
      .eq('status', 'sent');

    return {
      success: true,
      data: {
        ...campaign,
        progress: {
          total_groups: totalGroups || 0,
          sent_groups: sentGroups || 0,
        },
      },
    };
  });

  // Create campaign
  fastify.post('/', async (request: FastifyRequest<{ Body: CreateCampaignRequest }>, reply: FastifyReply) => {
    const parsed = createCampaignSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() },
      });
    }

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .insert({
        ...parsed.data,
        status: 'draft',
        stats: {
          total_groups: 0,
          messages_sent: 0,
          messages_failed: 0,
          responses_received: 0,
        },
      })
      .select()
      .single();

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return reply.status(201).send({ success: true, data: campaign });
  });

  // Update campaign
  fastify.patch(
    '/:id',
    async (request: FastifyRequest<{ Params: { id: string }; Body: UpdateCampaignRequest }>, reply: FastifyReply) => {
      const { id } = request.params;

      const { data: campaign, error } = await supabase
        .from('campaigns')
        .update(request.body)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
      }

      return { success: true, data: campaign };
    }
  );

  // Delete campaign
  fastify.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { error } = await supabase.from('campaigns').delete().eq('id', id);

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return { success: true, data: null };
  });

  // Start campaign - runs immediately, sends 1 message per group with configured delays
  fastify.post('/:id/start', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    // Validate campaign can be started
    const validation = await jobScheduler.validateCampaign(id);
    if (!validation.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: 'CAMPAIGN_INVALID',
          message: validation.error,
          details: validation.details,
        },
      });
    }

    // Update status to active
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .update({ status: 'active' })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    // Trigger campaign execution immediately
    jobScheduler.triggerCampaign(id).catch((err) => {
      console.error('Campaign execution failed:', err);
    });

    return {
      success: true,
      data: campaign,
      message: `Campaign started with ${validation.details?.totalGroups} groups, ${validation.details?.connectedAccounts} accounts`,
    };
  });

  // Restart campaign - reset all groups to pending and set to draft
  fastify.post('/:id/restart', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    try {
      const result = await jobScheduler.restartCampaign(id);

      const { data: campaign } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .single();

      return {
        success: true,
        data: campaign,
        message: `Campaign reset, ${result.reset} groups set to pending`,
      };
    } catch (err) {
      return reply.status(500).send({
        success: false,
        error: { code: 'RESTART_FAILED', message: (err as Error).message },
      });
    }
  });

  // Pause campaign
  fastify.post('/:id/pause', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    await jobScheduler.pauseCampaign(id);

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .update({ status: 'paused' })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return { success: true, data: campaign };
  });

  // Add groups to campaign
  fastify.post(
    '/:id/groups',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: { group_ids: string[] } }>,
      reply: FastifyReply
    ) => {
      const { id } = request.params;
      const { group_ids } = request.body;

      const campaignGroups = group_ids.map((group_id) => ({
        campaign_id: id,
        group_id,
        status: 'pending' as const,
      }));

      const { error } = await supabase.from('campaign_groups').upsert(campaignGroups, {
        onConflict: 'campaign_id,group_id',
      });

      if (error) {
        return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
      }

      return { success: true, data: { added: group_ids.length } };
    }
  );

  // Get campaign groups
  fastify.get('/:id/groups', async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const { data: groups, error } = await supabase
      .from('campaign_groups')
      .select('*, tg_groups(*)')
      .eq('campaign_id', id);

    if (error) {
      return reply.status(500).send({ success: false, error: { code: 'DB_ERROR', message: error.message } });
    }

    return { success: true, data: groups };
  });
}
