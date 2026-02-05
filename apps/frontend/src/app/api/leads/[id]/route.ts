import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

type Params = { params: Promise<{ id: string }> };

// GET /api/leads/[id]
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;

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
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Lead not found' } }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: lead });
}

// PATCH /api/leads/[id]
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const updates = await request.json();

  const { data: lead, error } = await supabase
    .from('leads')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: lead });
}

// DELETE /api/leads/[id]
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const { error } = await supabase.from('leads').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: null });
}
