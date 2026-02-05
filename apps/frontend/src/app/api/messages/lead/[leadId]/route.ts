import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

type Params = { params: Promise<{ leadId: string }> };

// GET /api/messages/lead/[leadId]
export async function GET(request: NextRequest, { params }: Params) {
  const { leadId } = await params;
  const limit = request.nextUrl.searchParams.get('limit') || '50';
  const before_id = request.nextUrl.searchParams.get('before_id');

  let query = supabase
    .from('messages')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(parseInt(limit, 10));

  if (before_id) {
    const { data: beforeMessage } = await supabase
      .from('messages')
      .select('created_at')
      .eq('id', before_id)
      .single();

    if (beforeMessage) {
      query = query.lt('created_at', beforeMessage.created_at);
    }
  }

  const { data: messages, error } = await query;

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: messages?.reverse() || [] });
}
