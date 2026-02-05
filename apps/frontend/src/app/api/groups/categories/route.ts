import { NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

// GET /api/groups/categories
export async function GET() {
  const { data, error } = await supabase
    .from('tg_groups')
    .select('category')
    .not('category', 'is', null);

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  const categories = Array.from(new Set(data?.map((g) => g.category).filter(Boolean)));

  return NextResponse.json({ success: true, data: categories });
}
