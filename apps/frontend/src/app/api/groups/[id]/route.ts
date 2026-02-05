import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

type Params = { params: Promise<{ id: string }> };

// GET /api/groups/[id]
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const { data: group, error } = await supabase.from('tg_groups').select('*').eq('id', id).single();

  if (error || !group) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Group not found' } }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: group });
}

// PATCH /api/groups/[id]
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const updates = await request.json();

  const { data: group, error } = await supabase
    .from('tg_groups')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: group });
}

// DELETE /api/groups/[id]
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const { error } = await supabase.from('tg_groups').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: null });
}
