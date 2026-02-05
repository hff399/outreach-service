import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

type Params = { params: Promise<{ id: string }> };

// GET /api/sequences/[id]
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const { data: sequence, error } = await supabase
    .from('sequences')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !sequence) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Sequence not found' } }, { status: 404 });
  }

  const { count: activeEnrollments } = await supabase
    .from('sequence_enrollments')
    .select('*', { count: 'exact', head: true })
    .eq('sequence_id', id)
    .eq('status', 'active');

  const { count: completedEnrollments } = await supabase
    .from('sequence_enrollments')
    .select('*', { count: 'exact', head: true })
    .eq('sequence_id', id)
    .eq('status', 'completed');

  return NextResponse.json({
    success: true,
    data: {
      ...sequence,
      stats: {
        active_enrollments: activeEnrollments || 0,
        completed_enrollments: completedEnrollments || 0,
      },
    },
  });
}

// PATCH /api/sequences/[id]
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const updates = await request.json();

  // If updating steps, add IDs
  if (updates.steps) {
    updates.steps = updates.steps.map((step: { id?: string }, index: number) => ({
      ...step,
      id: step.id || crypto.randomUUID(),
      order: index,
    }));
  }

  const { data: sequence, error } = await supabase
    .from('sequences')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: sequence });
}

// DELETE /api/sequences/[id]
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const { error } = await supabase.from('sequences').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: null });
}
