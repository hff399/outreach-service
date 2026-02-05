import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

type Params = { params: Promise<{ id: string }> };

// GET /api/accounts/[id] (proxied to backend)
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    const response = await fetch(`${BACKEND_URL}/api/accounts/${id}`);
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: { code: 'BACKEND_ERROR', message: error instanceof Error ? error.message : 'Failed to fetch account' },
    }, { status: 500 });
  }
}

// PATCH /api/accounts/[id]
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const updates = await request.json();

  const { data: account, error } = await supabase
    .from('tg_accounts')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: account });
}

// DELETE /api/accounts/[id] (proxied to backend to handle disconnection)
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    const response = await fetch(`${BACKEND_URL}/api/accounts/${id}`, {
      method: 'DELETE',
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: { code: 'BACKEND_ERROR', message: error instanceof Error ? error.message : 'Failed to delete account' },
    }, { status: 500 });
  }
}
