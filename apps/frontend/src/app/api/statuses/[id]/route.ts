import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

type Params = { params: Promise<{ id: string }> };

// GET /api/statuses/[id]
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const { data: status, error } = await supabase
    .from('lead_statuses')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !status) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Status not found' } }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: status });
}

// PATCH /api/statuses/[id]
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const updates = await request.json();

  // If setting as default, unset other defaults
  if (updates.is_default) {
    await supabase.from('lead_statuses').update({ is_default: false }).eq('is_default', true);
  }

  const { data: status, error } = await supabase
    .from('lead_statuses')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: status });
}

// DELETE /api/statuses/[id]
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  // Check if status is in use
  const { count } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('status_id', id);

  if (count && count > 0) {
    return NextResponse.json({
      success: false,
      error: { code: 'IN_USE', message: `Status is used by ${count} leads` },
    }, { status: 400 });
  }

  // Check if it's the default status
  const { data: status } = await supabase
    .from('lead_statuses')
    .select('is_default')
    .eq('id', id)
    .single();

  if (status?.is_default) {
    return NextResponse.json({
      success: false,
      error: { code: 'IS_DEFAULT', message: 'Cannot delete default status' },
    }, { status: 400 });
  }

  const { error } = await supabase.from('lead_statuses').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: null });
}
