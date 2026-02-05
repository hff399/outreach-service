import { NextResponse } from 'next/server';
import { supabase } from '@/lib/server/supabase';

// GET /api/leads/stats
export async function GET() {
  const { data: statusCounts, error } = await supabase
    .from('leads')
    .select('status_id, lead_statuses(name, color)')
    .order('status_id');

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 });
  }

  // Group by status
  const stats: Record<string, { name: string; color: string; count: number }> = {};
  for (const lead of statusCounts || []) {
    const statusId = lead.status_id;
    if (!stats[statusId]) {
      const status = lead.lead_statuses as unknown as { name: string; color: string } | null;
      stats[statusId] = {
        name: status?.name || 'Unknown',
        color: status?.color || '#6B7280',
        count: 0,
      };
    }
    stats[statusId].count++;
  }

  const { count: totalLeads } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true });

  const { count: newToday } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', new Date().toISOString().split('T')[0]);

  // Count unresponded leads (only from last 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: leadsWithMessages } = await supabase
    .from('messages')
    .select('lead_id, direction, created_at')
    .gte('created_at', sevenDaysAgo)
    .order('created_at', { ascending: false });

  const lastMessageByLead = new Map<string, string>();
  for (const msg of leadsWithMessages || []) {
    if (!lastMessageByLead.has(msg.lead_id)) {
      lastMessageByLead.set(msg.lead_id, msg.direction);
    }
  }

  const unrespondedCount = Array.from(lastMessageByLead.values())
    .filter(direction => direction === 'incoming').length;

  return NextResponse.json({
    success: true,
    data: {
      total: totalLeads || 0,
      new_today: newToday || 0,
      unresponded: unrespondedCount,
      by_status: Object.values(stats),
    },
  });
}
