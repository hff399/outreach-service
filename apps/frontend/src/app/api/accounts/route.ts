import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase } from '@/lib/server/supabase';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

const createAccountSchema = z.object({
  phone: z.string().min(10),
  proxy_config: z.object({
    type: z.enum(['socks5', 'http', 'mtproto']),
    host: z.string(),
    port: z.number(),
    username: z.string().optional(),
    password: z.string().optional(),
  }).optional(),
  daily_message_limit: z.number().min(1).max(500).optional(),
});

// GET /api/accounts - List all accounts (proxied to backend)
export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/accounts`);
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: { code: 'BACKEND_ERROR', message: error instanceof Error ? error.message : 'Failed to fetch accounts' },
    }, { status: 500 });
  }
}

// POST /api/accounts - Create new account
export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createAccountSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: parsed.error.flatten() },
    }, { status: 400 });
  }

  const { phone, proxy_config, daily_message_limit } = parsed.data;

  // Check if account already exists
  const { data: existing } = await supabase
    .from('tg_accounts')
    .select('id')
    .eq('phone', phone)
    .single();

  if (existing) {
    return NextResponse.json({
      success: false,
      error: { code: 'ALREADY_EXISTS', message: 'Account with this phone already exists' },
    }, { status: 409 });
  }

  const { data: account, error } = await supabase
    .from('tg_accounts')
    .insert({
      phone,
      proxy_config,
      daily_message_limit: daily_message_limit || 50,
      status: 'auth_required',
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: account }, { status: 201 });
}
