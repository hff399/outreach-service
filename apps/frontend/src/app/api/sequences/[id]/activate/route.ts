import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

type Params = { params: Promise<{ id: string }> };

// POST /api/sequences/[id]/activate
export async function POST(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const { data: sequence, error } = await supabase
    .from('sequences')
    .update({ status: 'active' })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: sequence });
}
