import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

type Params = { params: Promise<{ id: string }> };

// GET /api/campaigns/[id]
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const { data: campaign, error } = await supabase
    .from('campaigns')
    .select('*, message_templates(*)')
    .eq('id', id)
    .single();

  if (error || !campaign) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Campaign not found' } }, { status: 404 });
  }

  const { count: totalGroups } = await supabase
    .from('campaign_groups')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', id);

  const { count: sentGroups } = await supabase
    .from('campaign_groups')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', id)
    .eq('status', 'sent');

  return NextResponse.json({
    success: true,
    data: {
      ...campaign,
      progress: {
        total_groups: totalGroups || 0,
        sent_groups: sentGroups || 0,
      },
    },
  });
}

// PATCH /api/campaigns/[id]
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const updates = await request.json();

  const { data: campaign, error } = await supabase
    .from('campaigns')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: campaign });
}

// DELETE /api/campaigns/[id]
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const { error } = await supabase.from('campaigns').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: null });
}
