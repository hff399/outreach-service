import { supabase } from './supabase';
import { createLogger } from './logger';
import { telegramManager } from './telegram';
import { messageQueue, type CampaignMessagePayload } from './message-queue';

const logger = createLogger('CampaignService');

type Campaign = {
  id: string;
  status: string;
  assigned_accounts: string[];
  schedule_config?: {
    min_delay_seconds?: number;
    max_delay_seconds?: number;
    randomize_delay?: boolean;
    account_rotation?: 'round_robin' | 'random' | 'least_used';
  };
  message_templates?: { content?: string };
  custom_message?: string;
};

const campaignProgress = new Map<string, { sent: number; failed: number; total: number }>();
const accountUsage = new Map<string, number>();

// Listen for queue events
messageQueue.on('processed', async (item) => {
  if (item.type === 'campaign_message') {
    const payload = item.payload as unknown as CampaignMessagePayload;
    await handleMessageSent(payload);
  }
});

messageQueue.on('failed', async (item) => {
  if (item.type === 'campaign_message') {
    const payload = item.payload as unknown as CampaignMessagePayload;
    await handleMessageFailed(payload, item.lastError || 'Unknown error');
  }
});

export async function validateCampaign(campaignId: string): Promise<{ success: boolean; error?: string; details?: { totalGroups: number; connectedAccounts: number; hasMessage: boolean } }> {
  const { data: campaign } = await supabase.from('campaigns').select('*, message_templates(*)').eq('id', campaignId).single();
  if (!campaign) return { success: false, error: 'Campaign not found' };

  const { count } = await supabase.from('campaign_groups').select('*', { count: 'exact', head: true }).eq('campaign_id', campaignId).eq('status', 'pending');
  const totalGroups = count || 0;

  const connectedAccounts = telegramManager.getConnectedAccounts().filter(id => campaign.assigned_accounts?.includes(id));
  const messageText = campaign.message_templates?.content || campaign.custom_message || '';

  const details = { totalGroups, connectedAccounts: connectedAccounts.length, hasMessage: !!messageText };

  if (totalGroups === 0) return { success: false, error: 'No groups added', details };
  if (connectedAccounts.length === 0) return { success: false, error: 'No connected accounts', details };
  if (!messageText) return { success: false, error: 'No message content', details };

  return { success: true, details };
}

export async function executeCampaign(campaignId: string): Promise<{ queued: number; error?: string }> {
  const { data: campaign } = await supabase.from('campaigns').select('*, message_templates(*)').eq('id', campaignId).single();
  if (!campaign || campaign.status !== 'active') return { queued: 0, error: 'Campaign not active' };

  const config = campaign.schedule_config || {};
  const minDelayMs = (config.min_delay_seconds || 60) * 1000;
  const maxDelayMs = (config.max_delay_seconds || 180) * 1000;
  const randomize = config.randomize_delay !== false;

  // Get pending groups
  const { data: campaignGroups } = await supabase.from('campaign_groups').select('group_id').eq('campaign_id', campaignId).eq('status', 'pending');
  if (!campaignGroups?.length) return { queued: 0, error: 'No pending groups' };

  const { data: groups } = await supabase.from('tg_groups').select('*').in('id', campaignGroups.map(g => g.group_id)).eq('is_restricted', false);
  if (!groups?.length) return { queued: 0, error: 'No valid groups' };

  const connectedAccounts = telegramManager.getConnectedAccounts().filter(id => campaign.assigned_accounts?.includes(id));
  if (connectedAccounts.length === 0) return { queued: 0, error: 'No connected accounts' };

  const messageText = campaign.message_templates?.content || campaign.custom_message || '';
  if (!messageText) return { queued: 0, error: 'No message' };

  // Reset usage tracking
  accountUsage.clear();
  connectedAccounts.forEach(id => accountUsage.set(id, 0));

  campaignProgress.set(campaignId, { sent: 0, failed: 0, total: groups.length });

  let cumulativeDelay = 0;
  let queued = 0;

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const accountId = selectAccount(connectedAccounts, config.account_rotation || 'round_robin');
    accountUsage.set(accountId, (accountUsage.get(accountId) || 0) + 1);

    const text = messageText.replace(/\{group_name\}/g, group.title);

    messageQueue.enqueue('campaign_message', {
      campaignId,
      groupId: group.id,
      groupUsername: group.username || group.tg_id,
      groupTitle: group.title,
      accountId,
      messageText: text,
    } as unknown as Record<string, unknown>, { priority: 5, maxAttempts: 3, delayMs: cumulativeDelay });

    queued++;

    if (i < groups.length - 1) {
      cumulativeDelay += randomize ? Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs : minDelayMs;
    }
  }

  logger.info(`Queued ${queued} messages for campaign ${campaignId}`);
  return { queued };
}

function selectAccount(accounts: string[], strategy: string): string {
  if (accounts.length === 1) return accounts[0];
  if (strategy === 'random') return accounts[Math.floor(Math.random() * accounts.length)];
  // round_robin / least_used
  return [...accounts].sort((a, b) => (accountUsage.get(a) || 0) - (accountUsage.get(b) || 0))[0];
}

async function handleMessageSent(payload: CampaignMessagePayload): Promise<void> {
  await supabase.from('campaign_groups').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('campaign_id', payload.campaignId).eq('group_id', payload.groupId);

  const progress = campaignProgress.get(payload.campaignId);
  if (progress) {
    progress.sent++;
    if (progress.sent % 5 === 0 || progress.sent + progress.failed >= progress.total) {
      await updateStats(payload.campaignId, progress);
    }
    if (progress.sent + progress.failed >= progress.total) {
      await completeCampaign(payload.campaignId);
    }
  }
}

async function handleMessageFailed(payload: CampaignMessagePayload, error: string): Promise<void> {
  await supabase.from('campaign_groups').update({ status: 'failed', error_message: error }).eq('campaign_id', payload.campaignId).eq('group_id', payload.groupId);

  const progress = campaignProgress.get(payload.campaignId);
  if (progress) {
    progress.failed++;
    if (progress.sent + progress.failed >= progress.total) {
      await completeCampaign(payload.campaignId);
    }
  }
}

async function updateStats(campaignId: string, progress: { sent: number; failed: number; total: number }): Promise<void> {
  await supabase.from('campaigns').update({
    stats: { total_groups: progress.total, messages_sent: progress.sent, messages_failed: progress.failed, responses_received: 0 },
  }).eq('id', campaignId);
}

async function completeCampaign(campaignId: string): Promise<void> {
  await supabase.from('campaigns').update({ status: 'completed' }).eq('id', campaignId);
  campaignProgress.delete(campaignId);
  logger.info(`Campaign ${campaignId} completed`);
}

export async function pauseCampaign(campaignId: string): Promise<number> {
  const cancelled = messageQueue.cancelAll({ type: 'campaign_message', payloadMatch: { campaignId } });
  await supabase.from('campaigns').update({ status: 'paused' }).eq('id', campaignId);
  return cancelled;
}

export async function restartCampaign(campaignId: string): Promise<{ reset: number }> {
  messageQueue.cancelAll({ type: 'campaign_message', payloadMatch: { campaignId } });

  const { data } = await supabase.from('campaign_groups').update({ status: 'pending', sent_at: null, error_message: null }).eq('campaign_id', campaignId).select('group_id');
  await supabase.from('campaigns').update({ status: 'draft', stats: { total_groups: 0, messages_sent: 0, messages_failed: 0, responses_received: 0 } }).eq('id', campaignId);

  campaignProgress.delete(campaignId);
  return { reset: data?.length || 0 };
}

export function getCampaignProgress(campaignId: string) {
  const progress = campaignProgress.get(campaignId);
  if (!progress) return null;
  const pending = messageQueue.getItemsByPayload({ campaignId }).length;
  return { ...progress, pending };
}
