import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

type Params = { params: Promise<{ id: string }> };

// PATCH /api/leads/[id]/status
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const { status_id } = await request.json();

  const { data: lead, error } = await supabase
    .from('leads')
    .update({ status_id })
    .eq('id', id)
    .select('*, lead_statuses(id, name, color)')
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: lead });
}
