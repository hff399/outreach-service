import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

type Params = { params: Promise<{ id: string }> };

// GET /api/campaigns/[id]/groups
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const { data: groups, error } = await supabase
    .from('campaign_groups')
    .select('*, tg_groups(*)')
    .eq('campaign_id', id);

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: groups });
}

// POST /api/campaigns/[id]/groups
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const { group_ids } = await request.json();

  const campaignGroups = group_ids.map((group_id: string) => ({
    campaign_id: id,
    group_id,
    status: 'pending' as const,
  }));

  const { error } = await supabase.from('campaign_groups').upsert(campaignGroups, {
    onConflict: 'campaign_id,group_id',
  });

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: { added: group_ids.length } });
}
