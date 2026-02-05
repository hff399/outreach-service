import { NextResponse } from 'next/server';

// GET /api/scheduler - Deprecated: Scheduler now runs in backend automatically
export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'Scheduler is now running automatically in the backend. This endpoint is deprecated.',
  });
}

// POST /api/scheduler - Deprecated: Scheduler now runs in backend automatically
export async function POST() {
  return NextResponse.json({
    success: true,
    message: 'Scheduler is now running automatically in the backend. This endpoint is deprecated.',
  });
}
