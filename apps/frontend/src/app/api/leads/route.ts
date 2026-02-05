import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/server/supabase';

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

// GET /api/leads
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const status_ids = searchParams.get('status_ids');
  const campaign_ids = searchParams.get('campaign_ids');
  const account_ids = searchParams.get('account_ids');
  const search = searchParams.get('search');
  const date_from = searchParams.get('date_from');
  const date_to = searchParams.get('date_to');
  const needs_response = searchParams.get('needs_response');
  const page = searchParams.get('page') || '1';
  const page_size = searchParams.get('page_size') || '50';

  const pageNum = parseInt(page, 10);
  const pageSizeNum = parseInt(page_size, 10);
  const offset = (pageNum - 1) * pageSizeNum;

  // If filtering by needs_response
  if (needs_response === 'true') {
    // Only consider messages from the last 7 days to avoid showing very old leads
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: leadsWithMessages } = await supabase
      .from('messages')
      .select('lead_id, direction, created_at')
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false });

    const lastMessageByLead = new Map<string, string>();
    for (const msg of leadsWithMessages || []) {
      if (!lastMessageByLead.has(msg.lead_id)) {
        lastMessageByLead.set(msg.lead_id, msg.direction);
      }
    }

    const unrespondedIds = Array.from(lastMessageByLead.entries())
      .filter(([, direction]) => direction === 'incoming')
      .map(([leadId]) => leadId);

    if (unrespondedIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: { items: [], total: 0, page: pageNum, pageSize: pageSizeNum, totalPages: 0 },
      });
    }

    let query = supabase
      .from('leads')
      .select('*, lead_statuses(id, name, color), tg_accounts(id, phone, username)', { count: 'exact' })
      .in('id', unrespondedIds);

    if (status_ids && status_ids !== 'undefined') {
      query = query.in('status_id', status_ids.split(',').filter(id => id !== 'undefined'));
    }
    if (account_ids && account_ids !== 'undefined') {
      query = query.in('assigned_account_id', account_ids.split(',').filter(id => id !== 'undefined'));
    }
    if (search && search !== 'undefined') {
      query = query.or(`username.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
    }

    const { data: leads, error, count } = await query
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(offset, offset + pageSizeNum - 1);

    if (error) {
      return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        items: leads,
        total: count || 0,
        page: pageNum,
        pageSize: pageSizeNum,
        totalPages: Math.ceil((count || 0) / pageSizeNum),
      },
    });
  }

  let query = supabase
    .from('leads')
    .select('*, lead_statuses(id, name, color), tg_accounts(id, phone, username)', { count: 'exact' });

  if (status_ids && status_ids !== 'undefined') {
    query = query.in('status_id', status_ids.split(',').filter(id => id !== 'undefined'));
  }
  if (campaign_ids && campaign_ids !== 'undefined') {
    query = query.in('source_campaign_id', campaign_ids.split(',').filter(id => id !== 'undefined'));
  }
  if (account_ids && account_ids !== 'undefined') {
    query = query.in('assigned_account_id', account_ids.split(',').filter(id => id !== 'undefined'));
  }
  if (search && search !== 'undefined') {
    query = query.or(`username.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
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
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: {
      items: leads,
      total: count || 0,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.ceil((count || 0) / pageSizeNum),
    },
  });
}

// POST /api/leads
export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createLeadSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() },
    }, { status: 400 });
  }

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
      return NextResponse.json({
        success: false,
        error: { code: 'ALREADY_EXISTS', message: 'Lead with this TG user ID already exists' },
      }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: lead }, { status: 201 });
}
