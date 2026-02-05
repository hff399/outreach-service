import { NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

// GET /api/messages/unread
export async function GET() {
  const { count, error } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('direction', 'incoming')
    .neq('status', 'read');

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: { unread: count || 0 } });
}
