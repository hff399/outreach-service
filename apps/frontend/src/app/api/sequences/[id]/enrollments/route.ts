import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

type Params = { params: Promise<{ id: string }> };

// GET /api/sequences/[id]/enrollments
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const { data: enrollments, error } = await supabase
    .from('sequence_enrollments')
    .select('*, leads(id, username, first_name, last_name)')
    .eq('sequence_id', id)
    .order('started_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: enrollments });
}
