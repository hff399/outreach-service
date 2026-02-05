import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/server/supabase';

const createStatusSchema = z.object({
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  order: z.number().optional(),
  is_default: z.boolean().optional(),
  is_final: z.boolean().optional(),
});

// GET /api/statuses
export async function GET() {
  const { data: statuses, error } = await supabase
    .from('lead_statuses')
    .select('*')
    .order('order', { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: statuses });
}

// POST /api/statuses
export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createStatusSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() },
    }, { status: 400 });
  }

  // Get max order
  const { data: maxOrder } = await supabase
    .from('lead_statuses')
    .select('order')
    .order('order', { ascending: false })
    .limit(1)
    .single();

  const order = parsed.data.order ?? ((maxOrder?.order ?? 0) + 1);

  // If setting as default, unset other defaults
  if (parsed.data.is_default) {
    await supabase.from('lead_statuses').update({ is_default: false }).eq('is_default', true);
  }

  const { data: status, error } = await supabase
    .from('lead_statuses')
    .insert({ ...parsed.data, order })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: status }, { status: 201 });
}
