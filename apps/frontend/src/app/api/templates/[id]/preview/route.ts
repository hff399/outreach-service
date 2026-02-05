import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

type Params = { params: Promise<{ id: string }> };

// POST /api/templates/[id]/preview
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const { variables } = await request.json();

  const { data: template, error } = await supabase
    .from('message_templates')
    .select('content')
    .eq('id', id)
    .single();

  if (error || !template) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Template not found' } }, { status: 404 });
  }

  // Apply variables
  let preview = template.content;
  for (const [key, value] of Object.entries(variables as Record<string, string>)) {
    preview = preview.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }

  return NextResponse.json({ success: true, data: { preview } });
}
