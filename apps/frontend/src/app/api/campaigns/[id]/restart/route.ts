import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

type Params = { params: Promise<{ id: string }> };

// POST /api/campaigns/[id]/restart (proxied to backend)
export async function POST(_request: NextRequest, { params }: Params) {
  const { id } = await params;

  try {
    const response = await fetch(`${BACKEND_URL}/api/campaigns/${id}/restart`, {
      method: 'POST',
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: { code: 'BACKEND_ERROR', message: error instanceof Error ? error.message : 'Failed to restart campaign' },
    }, { status: 500 });
  }
}
