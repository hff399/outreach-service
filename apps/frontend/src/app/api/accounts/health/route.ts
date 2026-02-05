import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

// GET /api/accounts/health
export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/accounts/health/all`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
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
