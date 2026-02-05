import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/server/supabase';

const importGroupsSchema = z.object({
  groups: z.array(z.object({
    tg_id: z.string().min(1),
    username: z.string().optional(),
    title: z.string().min(1),
    description: z.string().optional(),
    member_count: z.number().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })),
});

// GET /api/groups
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const category = searchParams.get('category');
  const search = searchParams.get('search');
  const min_members = searchParams.get('min_members');
  const max_members = searchParams.get('max_members');
  const page = searchParams.get('page') || '1';
  const page_size = searchParams.get('page_size') || '50';

  const pageNum = parseInt(page, 10);
  const pageSizeNum = parseInt(page_size, 10);
  const offset = (pageNum - 1) * pageSizeNum;

  let query = supabase.from('tg_groups').select('*', { count: 'exact' });

  if (category && category !== 'undefined') {
    query = query.eq('category', category);
  }
  if (search && search !== 'undefined') {
    query = query.or(`title.ilike.%${search}%,username.ilike.%${search}%,description.ilike.%${search}%`);
  }
  if (min_members) {
    query = query.gte('member_count', parseInt(min_members, 10));
  }
  if (max_members) {
    query = query.lte('member_count', parseInt(max_members, 10));
  }

  const { data: groups, error, count } = await query
    .order('member_count', { ascending: false, nullsFirst: false })
    .range(offset, offset + pageSizeNum - 1);

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: {
      items: groups,
      total: count || 0,
      page: pageNum,
      pageSize: pageSizeNum,
      totalPages: Math.ceil((count || 0) / pageSizeNum),
    },
  });
}

// POST /api/groups (import)
export async function POST(request: NextRequest) {
  const body = await request.json();

  // Check if it's a bulk delete
  if (body.ids && Array.isArray(body.ids)) {
    const { error } = await supabase.from('tg_groups').delete().in('id', body.ids);
    if (error) {
      return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
    }
    return NextResponse.json({ success: true, data: { deleted: body.ids.length } });
  }

  const parsed = importGroupsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() },
    }, { status: 400 });
  }

  const groupsToInsert = parsed.data.groups.map((group) => ({
    tg_id: group.tg_id,
    username: group.username,
    title: group.title,
    description: group.description,
    member_count: group.member_count,
    category: group.category,
    tags: group.tags || [],
  }));

  const { data: groups, error } = await supabase
    .from('tg_groups')
    .upsert(groupsToInsert, { onConflict: 'tg_id', ignoreDuplicates: false })
    .select();

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: { imported: groups?.length || 0, groups } }, { status: 201 });
}
