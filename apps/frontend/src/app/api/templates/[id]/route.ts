import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

type Params = { params: Promise<{ id: string }> };

function parseTemplateVariables(content: string): string[] {
  const matches = content.match(/\{\{(\w+)\}\}/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map(m => m.replace(/\{\{|\}\}/g, ''))));
}

// GET /api/templates/[id]
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const { data: template, error } = await supabase
    .from('message_templates')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !template) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found' } }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: template });
}

// PATCH /api/templates/[id]
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const updates = await request.json();

  // Re-parse variables if content changed
  if (updates.content) {
    updates.variables = parseTemplateVariables(updates.content);
  }

  const { data: template, error } = await supabase
    .from('message_templates')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: template });
}

// DELETE /api/templates/[id]
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  const { error } = await supabase.from('message_templates').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: null });
}
