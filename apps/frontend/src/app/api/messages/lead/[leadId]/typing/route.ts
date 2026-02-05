import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

type Params = { params: Promise<{ leadId: string }> };

// POST /api/messages/lead/[leadId]/typing
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const { leadId } = await params;
    const response = await fetch(`${BACKEND_URL}/api/messages/lead/${leadId}/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
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
