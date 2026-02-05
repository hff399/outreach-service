import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

// POST /api/statuses/reorder
export async function POST(request: NextRequest) {
  const { order } = await request.json();

  const updates = order.map((id: string, index: number) => ({
    id,
    order: index,
  }));

  for (const update of updates) {
    await supabase.from('lead_statuses').update({ order: update.order }).eq('id', update.id);
  }

  return NextResponse.json({ success: true, data: null });
}
