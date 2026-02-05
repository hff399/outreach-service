import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { TgAccountManager } from './tg-account-manager.js';
import { WebSocketHub } from './websocket-hub.js';
import { messageQueue, type CampaignMessagePayload } from './message-queue.js';
import { applyTemplate } from '@outreach/shared/utils/index.js';
import type { Campaign, TgGroup, MessageTemplate } from '@outreach/shared/types/entities.js';

const logger = createLogger('CampaignService');

type ScheduleConfig = {
  min_delay_seconds?: number;
  max_delay_seconds?: number;
  randomize_delay?: boolean;
  account_rotation?: 'round_robin' | 'random' | 'least_used';
};

export type CampaignStartResult = {
  success: boolean;
  error?: string;
  details?: {
    totalGroups: number;
    connectedAccounts: number;
    hasMessage: boolean;
  };
};

export class CampaignService {
  private accountUsageCount: Map<string, number> = new Map();
  private runningCampaigns: Set<string> = new Set();
  private campaignProgress: Map<string, { sent: number; failed: number; total: number }> = new Map();

  constructor(
    private tgManager: TgAccountManager,
    private wsHub: WebSocketHub
  ) {
    // Listen for queue events to track progress
    messageQueue.on('processed', (item) => {
      if (item.type === 'campaign_message') {
        const payload = item.payload as unknown as CampaignMessagePayload;
        this.handleMessageSent(payload);
      }
    });

    messageQueue.on('failed', (item) => {
      if (item.type === 'campaign_message') {
        const payload = item.payload as unknown as CampaignMessagePayload;
        this.handleMessageFailed(payload, item.lastError || 'Unknown error');
      }
    });
  }

  /**
   * Check if campaign can be started and return detailed info
   */
  async validateCampaign(campaignId: string): Promise<CampaignStartResult> {
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .select('*, message_templates(*)')
      .eq('id', campaignId)
      .single();

    if (error || !campaign) {
      return { success: false, error: 'Campaign not found' };
    }

    const { count: pendingGroupCount } = await supabase
      .from('campaign_groups')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', 'pending');

    const totalGroups = pendingGroupCount || 0;

    const connectedAccounts = this.tgManager.getConnectedAccounts()
      .filter((id) => campaign.assigned_accounts?.includes(id));

    const template = campaign.message_templates as MessageTemplate | null;
    const messageText = template?.content || campaign.custom_message || '';
    const hasMessage = !!messageText;

    const details = {
      totalGroups,
      connectedAccounts: connectedAccounts.length,
      hasMessage,
    };

    if (totalGroups === 0) {
      return { success: false, error: 'No groups added to campaign', details };
    }

    if (connectedAccounts.length === 0) {
      return { success: false, error: 'No connected accounts assigned to campaign', details };
    }

    if (!hasMessage) {
      return { success: false, error: 'No message template or custom message set', details };
    }

    return { success: true, details };
  }

  /**
   * Execute campaign using the internal queue - much more robust
   */
  async executeCampaign(campaignId: string): Promise<{ queued: number; error?: string }> {
    if (this.runningCampaigns.has(campaignId)) {
      logger.warn(`Campaign ${campaignId} is already running`);
      return { queued: 0, error: 'Campaign already running' };
    }

    this.runningCampaigns.add(campaignId);

    try {
      // Fetch campaign with template
      const { data: campaign, error } = await supabase
        .from('campaigns')
        .select('*, message_templates(*)')
        .eq('id', campaignId)
        .single();

      if (error || !campaign) {
        logger.error(`Campaign not found: ${campaignId}`);
        return { queued: 0, error: 'Campaign not found' };
      }

      if (campaign.status !== 'active') {
        logger.warn(`Campaign ${campaignId} is not active`);
        return { queued: 0, error: 'Campaign not active' };
      }

      const scheduleConfig = (campaign.schedule_config || {}) as ScheduleConfig;

      // Get groups to send to
      const groups = await this.getTargetGroups(campaign as Campaign);
      if (groups.length === 0) {
        logger.info(`No groups remaining for campaign ${campaignId}`);
        await this.completeCampaign(campaignId);
        return { queued: 0, error: 'No groups remaining' };
      }

      // Get available accounts
      const connectedAccounts = this.tgManager.getConnectedAccounts()
        .filter((id) => campaign.assigned_accounts?.includes(id));

      if (connectedAccounts.length === 0) {
        logger.error(`No connected accounts for campaign ${campaignId}`);
        this.wsHub.emitCampaignStatus(campaignId, 'error', 'No connected accounts available');
        await supabase.from('campaigns').update({ status: 'paused' }).eq('id', campaignId);
        return { queued: 0, error: 'No connected accounts' };
      }

      const template = campaign.message_templates as MessageTemplate | null;
      const messageText = template?.content || campaign.custom_message || '';

      if (!messageText) {
        logger.error(`Campaign ${campaignId} has no message content`);
        return { queued: 0, error: 'No message content' };
      }

      // Calculate delays
      const minDelayMs = (scheduleConfig.min_delay_seconds || 60) * 1000;
      const maxDelayMs = (scheduleConfig.max_delay_seconds || 180) * 1000;
      const randomizeDelay = scheduleConfig.randomize_delay !== false;

      // Reset account usage for rotation
      this.accountUsageCount.clear();
      connectedAccounts.forEach(id => this.accountUsageCount.set(id, 0));

      // Initialize progress tracking
      this.campaignProgress.set(campaignId, { sent: 0, failed: 0, total: groups.length });

      logger.info(`Queueing campaign ${campaignId}: ${groups.length} groups, delay ${minDelayMs/1000}-${maxDelayMs/1000}s`);

      // Emit campaign started event
      this.wsHub.emitCampaignStatus(campaignId, 'running', `Sending to ${groups.length} groups`);

      // Queue each message with appropriate delays
      let cumulativeDelay = 0;
      let queued = 0;

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];

        // Select account based on rotation strategy
        const accountId = this.selectAccount(connectedAccounts, scheduleConfig.account_rotation || 'round_robin');
        this.incrementAccountUsage(accountId);

        // Apply template variables
        const text = applyTemplate(messageText, { group_name: group.title });

        const payload: CampaignMessagePayload = {
          campaignId,
          groupId: group.id,
          groupUsername: group.username || group.tg_id,
          groupTitle: group.title,
          accountId,
          messageText: text,
          templateVariables: { group_name: group.title },
        };

        // Queue with delay
        messageQueue.enqueue('campaign_message', payload as unknown as Record<string, unknown>, {
          priority: 5,
          maxAttempts: 3,
          delayMs: cumulativeDelay,
        });

        queued++;

        // Calculate delay for next message
        if (i < groups.length - 1) {
          const delay = randomizeDelay
            ? this.randomBetween(minDelayMs, maxDelayMs)
            : minDelayMs;
          cumulativeDelay += delay;
        }
      }

      logger.info(`Queued ${queued} messages for campaign ${campaignId}, total delay: ${Math.round(cumulativeDelay / 1000)}s`);

      return { queued };

    } catch (error) {
      logger.error(`Failed to queue campaign ${campaignId}`, error);
      return { queued: 0, error: (error as Error).message };
    }
  }

  /**
   * Handle successful message send
   */
  private async handleMessageSent(payload: CampaignMessagePayload): Promise<void> {
    const { campaignId, groupId, groupTitle } = payload;

    // Update campaign_groups status
    await supabase
      .from('campaign_groups')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
      })
      .eq('campaign_id', campaignId)
      .eq('group_id', groupId);

    // Update progress
    const progress = this.campaignProgress.get(campaignId);
    if (progress) {
      progress.sent++;

      logger.info(`[${progress.sent}/${progress.total}] Sent to ${groupTitle}`);

      // Emit WebSocket progress
      this.wsHub.emitCampaignProgress(campaignId, {
        campaign_id: campaignId,
        total_groups: progress.total,
        messages_sent: progress.sent,
        messages_failed: progress.failed,
        current_group: groupTitle,
        progress_percent: Math.round((progress.sent / progress.total) * 100),
      });

      // Update campaign stats periodically
      if (progress.sent % 5 === 0 || progress.sent + progress.failed >= progress.total) {
        await this.updateCampaignStats(campaignId, progress.total, progress.sent, progress.failed);
      }

      // Check if campaign is complete
      if (progress.sent + progress.failed >= progress.total) {
        await this.completeCampaign(campaignId);
      }
    }
  }

  /**
   * Handle failed message send
   */
  private async handleMessageFailed(payload: CampaignMessagePayload, error: string): Promise<void> {
    const { campaignId, groupId, groupTitle } = payload;

    // Update campaign_groups status
    await supabase
      .from('campaign_groups')
      .update({
        status: 'failed',
        error_message: error,
      })
      .eq('campaign_id', campaignId)
      .eq('group_id', groupId);

    // Update progress
    const progress = this.campaignProgress.get(campaignId);
    if (progress) {
      progress.failed++;

      logger.error(`Failed to send to ${groupTitle}: ${error}`);

      // Emit WebSocket progress
      this.wsHub.emitCampaignProgress(campaignId, {
        campaign_id: campaignId,
        total_groups: progress.total,
        messages_sent: progress.sent,
        messages_failed: progress.failed,
        current_group: groupTitle,
        progress_percent: Math.round(((progress.sent + progress.failed) / progress.total) * 100),
      });

      // Check if campaign is complete
      if (progress.sent + progress.failed >= progress.total) {
        await this.completeCampaign(campaignId);
      }
    }
  }

  /**
   * Select account based on rotation strategy
   */
  private selectAccount(accounts: string[], strategy: 'round_robin' | 'random' | 'least_used'): string {
    if (accounts.length === 1) return accounts[0];

    switch (strategy) {
      case 'random':
        return accounts[Math.floor(Math.random() * accounts.length)];

      case 'least_used':
        let minUsage = Infinity;
        let leastUsedAccount = accounts[0];
        for (const accountId of accounts) {
          const usage = this.accountUsageCount.get(accountId) || 0;
          if (usage < minUsage) {
            minUsage = usage;
            leastUsedAccount = accountId;
          }
        }
        return leastUsedAccount;

      case 'round_robin':
      default:
        const sorted = [...accounts].sort((a, b) => {
          const usageA = this.accountUsageCount.get(a) || 0;
          const usageB = this.accountUsageCount.get(b) || 0;
          return usageA - usageB;
        });
        return sorted[0];
    }
  }

  private incrementAccountUsage(accountId: string): void {
    const current = this.accountUsageCount.get(accountId) || 0;
    this.accountUsageCount.set(accountId, current + 1);
  }

  private async getTargetGroups(campaign: Campaign): Promise<TgGroup[]> {
    const { data: campaignGroups } = await supabase
      .from('campaign_groups')
      .select('group_id')
      .eq('campaign_id', campaign.id)
      .eq('status', 'pending');

    if (!campaignGroups || campaignGroups.length === 0) {
      return [];
    }

    const groupIds = campaignGroups.map(cg => cg.group_id);

    const { data: groups, error } = await supabase
      .from('tg_groups')
      .select('*')
      .in('id', groupIds)
      .eq('is_restricted', false);

    if (error) {
      logger.error('Failed to fetch groups', error);
      return [];
    }

    return (groups || []) as TgGroup[];
  }

  private async updateCampaignStats(
    campaignId: string,
    totalGroups: number,
    messagesSent: number,
    messagesFailed: number
  ): Promise<void> {
    await supabase
      .from('campaigns')
      .update({
        stats: {
          total_groups: totalGroups,
          messages_sent: messagesSent,
          messages_failed: messagesFailed,
          responses_received: 0,
        },
      })
      .eq('id', campaignId);
  }

  private async completeCampaign(campaignId: string): Promise<void> {
    await supabase
      .from('campaigns')
      .update({ status: 'completed' })
      .eq('id', campaignId);

    this.runningCampaigns.delete(campaignId);
    this.campaignProgress.delete(campaignId);

    logger.info(`Campaign ${campaignId} completed`);
    this.wsHub.emitCampaignStatus(campaignId, 'completed', 'All messages sent');
  }

  async pauseCampaign(campaignId: string): Promise<void> {
    // Cancel all pending messages for this campaign
    const cancelled = messageQueue.cancelAll({
      type: 'campaign_message',
      payloadMatch: { campaignId },
    });

    logger.info(`Paused campaign ${campaignId}, cancelled ${cancelled} pending messages`);

    await supabase
      .from('campaigns')
      .update({ status: 'paused' })
      .eq('id', campaignId);

    this.runningCampaigns.delete(campaignId);
  }

  async resumeCampaign(campaignId: string): Promise<void> {
    await supabase
      .from('campaigns')
      .update({ status: 'active' })
      .eq('id', campaignId);

    // Re-execute to queue remaining groups
    await this.executeCampaign(campaignId);
  }

  /**
   * Restart campaign - reset all groups to pending status
   */
  async restartCampaign(campaignId: string): Promise<{ reset: number }> {
    // Cancel any pending messages
    messageQueue.cancelAll({
      type: 'campaign_message',
      payloadMatch: { campaignId },
    });

    // Reset all campaign_groups to pending
    const { data: updated } = await supabase
      .from('campaign_groups')
      .update({
        status: 'pending',
        sent_at: null,
        error_message: null,
      })
      .eq('campaign_id', campaignId)
      .select('group_id');

    // Reset campaign stats
    await supabase
      .from('campaigns')
      .update({
        status: 'draft',
        stats: {
          total_groups: 0,
          messages_sent: 0,
          messages_failed: 0,
          responses_received: 0,
        },
      })
      .eq('id', campaignId);

    // Clear state
    this.accountUsageCount.clear();
    this.runningCampaigns.delete(campaignId);
    this.campaignProgress.delete(campaignId);

    const resetCount = updated?.length || 0;
    logger.info(`Campaign ${campaignId} restarted, reset ${resetCount} groups`);

    return { reset: resetCount };
  }

  /**
   * Check if campaign is currently running
   */
  isRunning(campaignId: string): boolean {
    return this.runningCampaigns.has(campaignId);
  }

  /**
   * Get campaign progress
   */
  getProgress(campaignId: string): { sent: number; failed: number; total: number; pending: number } | null {
    const progress = this.campaignProgress.get(campaignId);
    if (!progress) return null;

    const pendingItems = messageQueue.getItemsByPayload({ campaignId });
    return { ...progress, pending: pendingItems.length };
  }

  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
