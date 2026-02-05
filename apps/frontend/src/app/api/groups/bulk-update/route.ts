import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

// POST /api/groups/bulk-update
export async function POST(request: NextRequest) {
  const { ids, ...updates } = await request.json();

  const { error } = await supabase.from('tg_groups').update(updates).in('id', ids);

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: { updated: ids.length } });
}
