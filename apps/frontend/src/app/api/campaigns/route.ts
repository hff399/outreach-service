import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/server/supabase';

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

// GET /api/campaigns
export async function GET(request: NextRequest) {
  const status = request.nextUrl.searchParams.get('status');

  let query = supabase
    .from('campaigns')
    .select('*, message_templates(id, name)')
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data: campaigns, error } = await query;

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  // Get actual group counts
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

  return NextResponse.json({ success: true, data: campaignsWithCounts });
}

// POST /api/campaigns
export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createCampaignSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() },
    }, { status: 400 });
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
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: campaign }, { status: 201 });
}
