import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

// GET /api/poll - Polling endpoint for real-time updates
export async function GET(request: NextRequest) {
  const since = request.nextUrl.searchParams.get('since');
  const sinceDate = since ? new Date(since).toISOString() : new Date(Date.now() - 30000).toISOString();

  // Get new messages since last poll
  const { data: newMessages } = await supabase
    .from('messages')
    .select('id, lead_id, direction, content, created_at')
    .gt('created_at', sinceDate)
    .order('created_at', { ascending: false })
    .limit(50);

  // Get unread count
  const { count: unreadCount } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('direction', 'incoming')
    .neq('status', 'read');

  // Get account statuses from backend
  let accountStatuses = [];
  try {
    const response = await fetch(`${BACKEND_URL}/api/accounts`);
    if (response.ok) {
      const result = await response.json();
      if (result.success && result.data) {
        accountStatuses = result.data.map((acc: any) => ({
          id: acc.id,
          phone: acc.phone,
          status: acc.status,
          is_connected: acc.is_connected,
        }));
      }
    }
  } catch (error) {
    console.error('Failed to fetch account statuses from backend:', error);
  }

  // Get active campaigns progress
  const { data: activeCampaigns } = await supabase
    .from('campaigns')
    .select('id, name, status')
    .eq('status', 'active');

  const campaignProgress = (activeCampaigns || []).map(campaign => ({
    id: campaign.id,
    name: campaign.name,
    progress: null, // Campaign progress is now tracked in backend
  }));

  // Queue stats are now in backend - stub for now
  const queueStats = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  };

  return NextResponse.json({
    success: true,
    data: {
      timestamp: new Date().toISOString(),
      messages: {
        new: newMessages || [],
        unread_count: unreadCount || 0,
      },
      accounts: accountStatuses,
      campaigns: campaignProgress,
      queue: queueStats,
    },
  });
}
