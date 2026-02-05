import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/server/supabase';

const createTemplateSchema = z.object({
  name: z.string().min(1),
  content: z.string().min(1),
});

function parseTemplateVariables(content: string): string[] {
  const matches = content.match(/\{\{(\w+)\}\}/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map(m => m.replace(/\{\{|\}\}/g, ''))));
}

// GET /api/templates
export async function GET() {
  const { data: templates, error } = await supabase
    .from('message_templates')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: templates });
}

// POST /api/templates
export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createTemplateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() },
    }, { status: 400 });
  }

  const variables = parseTemplateVariables(parsed.data.content);

  const { data: template, error } = await supabase
    .from('message_templates')
    .insert({ ...parsed.data, variables })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: template }, { status: 201 });
}
