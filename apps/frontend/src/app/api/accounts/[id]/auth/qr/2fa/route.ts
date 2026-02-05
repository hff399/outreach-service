import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

type Params = { params: Promise<{ id: string }> };

// POST /api/accounts/[id]/auth/qr/2fa
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const response = await fetch(`${BACKEND_URL}/api/accounts/${id}/auth/qr/2fa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: 'PROXY_ERROR', message: (error as Error).message } },
      { status: 500 }
    );
  }
}
