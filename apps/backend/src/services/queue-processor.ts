import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { TgAccountManager } from './tg-account-manager.js';
import { WebSocketHub } from './websocket-hub.js';
import { executeSequenceStep } from './sequence-executor.js';
import { applyTemplate } from '@outreach/shared/utils/index.js';
import {
  messageQueue,
  type QueueItem,
  type CampaignMessagePayload,
  type SequenceStepPayload,
} from './message-queue.js';

const logger = createLogger('QueueProcessor');

export class QueueProcessor {
  private campaignProgress: Map<string, { sent: number; failed: number; total: number }> = new Map();

  constructor(
    private tgManager: TgAccountManager,
    private wsHub: WebSocketHub
  ) {
    this.registerProcessors();
  }

  private registerProcessors(): void {
    // Register campaign message processor
    messageQueue.registerProcessor('campaign_message', async (item: QueueItem) => {
      await this.processCampaignMessage(item.payload as unknown as CampaignMessagePayload);
    });

    // Register sequence step processor
    messageQueue.registerProcessor('sequence_step', async (item: QueueItem) => {
      await this.processSequenceStep(item.payload as unknown as SequenceStepPayload);
    });

    logger.info('Queue processors registered');
  }

  /**
   * Process a campaign message (send to group)
   */
  private async processCampaignMessage(payload: CampaignMessagePayload): Promise<void> {
    const { campaignId, groupId, groupUsername, groupTitle, accountId, messageText, templateVariables } = payload;

    logger.info(`Processing campaign message for group ${groupTitle}`, { campaignId, groupId });

    // Check if campaign is still active
    const { data: campaign } = await supabase
      .from('campaigns')
      .select('status')
      .eq('id', campaignId)
      .single();

    if (campaign?.status !== 'active') {
      logger.info(`Campaign ${campaignId} no longer active, skipping message`);
      return;
    }

    // Check if account is connected
    if (!this.tgManager.isConnected(accountId)) {
      throw new Error(`Account ${accountId} is not connected`);
    }

    // Apply template variables
    const text = applyTemplate(messageText, templateVariables || { group_name: groupTitle });

    // Send message to group
    await this.tgManager.sendToGroup(accountId, groupUsername || groupId, text);

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
    const progress = this.campaignProgress.get(campaignId) || { sent: 0, failed: 0, total: 0 };
    progress.sent++;
    this.campaignProgress.set(campaignId, progress);

    logger.info(`Sent campaign message to ${groupTitle}`, {
      campaignId,
      progress: `${progress.sent}/${progress.total}`,
    });

    // Emit WebSocket progress
    this.wsHub.emitCampaignProgress(campaignId, {
      campaign_id: campaignId,
      total_groups: progress.total,
      messages_sent: progress.sent,
      messages_failed: progress.failed,
      current_group: groupTitle,
      progress_percent: Math.round((progress.sent / progress.total) * 100),
    });

    // Update campaign stats
    await this.updateCampaignStats(campaignId, progress.total, progress.sent, progress.failed);

    // Check if campaign is complete
    if (progress.sent + progress.failed >= progress.total) {
      await this.completeCampaign(campaignId);
    }
  }

  /**
   * Process a sequence step
   */
  private async processSequenceStep(payload: SequenceStepPayload): Promise<void> {
    const { enrollmentId, stepId, sequenceId, leadId } = payload;

    logger.info(`Processing sequence step`, { enrollmentId, stepId, sequenceId, leadId });

    // Execute the step
    await executeSequenceStep(enrollmentId, stepId);

    logger.info(`Completed sequence step`, { enrollmentId, stepId });
  }

  /**
   * Queue a campaign for execution
   */
  async queueCampaign(campaignId: string): Promise<{ queued: number; error?: string }> {
    logger.info(`Queueing campaign ${campaignId}`);

    // Fetch campaign with template
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .select('*, message_templates(*)')
      .eq('id', campaignId)
      .single();

    if (error || !campaign) {
      return { queued: 0, error: 'Campaign not found' };
    }

    // Get schedule config
    const scheduleConfig = (campaign.schedule_config || {}) as {
      min_delay_seconds?: number;
      max_delay_seconds?: number;
      randomize_delay?: boolean;
      account_rotation?: 'round_robin' | 'random' | 'least_used';
    };

    // Get groups to send to
    const { data: campaignGroups } = await supabase
      .from('campaign_groups')
      .select('group_id')
      .eq('campaign_id', campaignId)
      .eq('status', 'pending');

    if (!campaignGroups || campaignGroups.length === 0) {
      return { queued: 0, error: 'No pending groups' };
    }

    const groupIds = campaignGroups.map(cg => cg.group_id);

    const { data: groups } = await supabase
      .from('tg_groups')
      .select('*')
      .in('id', groupIds)
      .eq('is_restricted', false);

    if (!groups || groups.length === 0) {
      return { queued: 0, error: 'No valid groups found' };
    }

    // Get available accounts
    const connectedAccounts = this.tgManager.getConnectedAccounts()
      .filter((id) => campaign.assigned_accounts?.includes(id));

    if (connectedAccounts.length === 0) {
      return { queued: 0, error: 'No connected accounts assigned' };
    }

    // Get message text
    const template = campaign.message_templates as { content?: string } | null;
    const messageText = template?.content || campaign.custom_message || '';

    if (!messageText) {
      return { queued: 0, error: 'No message content' };
    }

    // Calculate delays
    const minDelayMs = (scheduleConfig.min_delay_seconds || 60) * 1000;
    const maxDelayMs = (scheduleConfig.max_delay_seconds || 180) * 1000;
    const randomizeDelay = scheduleConfig.randomize_delay !== false;

    // Track account usage for rotation
    const accountUsage: Map<string, number> = new Map();
    connectedAccounts.forEach(id => accountUsage.set(id, 0));

    // Initialize progress tracking
    this.campaignProgress.set(campaignId, { sent: 0, failed: 0, total: groups.length });

    // Queue each message with appropriate delays
    let cumulativeDelay = 0;
    let queued = 0;

    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];

      // Select account based on rotation strategy
      const accountId = this.selectAccount(connectedAccounts, accountUsage, scheduleConfig.account_rotation || 'round_robin');
      accountUsage.set(accountId, (accountUsage.get(accountId) || 0) + 1);

      const payload: CampaignMessagePayload = {
        campaignId,
        groupId: group.id,
        groupUsername: group.username || group.tg_id,
        groupTitle: group.title,
        accountId,
        messageText,
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

    logger.info(`Queued ${queued} messages for campaign ${campaignId}`, {
      totalDelay: `${Math.round(cumulativeDelay / 1000)}s`,
    });

    // Emit started event
    this.wsHub.emitCampaignStatus(campaignId, 'running', `Sending to ${groups.length} groups`);

    return { queued };
  }

  /**
   * Queue a sequence step for execution
   */
  queueSequenceStep(
    enrollmentId: string,
    stepId: string,
    sequenceId: string,
    leadId: string,
    accountId?: string,
    delayMs = 0
  ): string {
    const payload: SequenceStepPayload = {
      enrollmentId,
      stepId,
      sequenceId,
      leadId,
      accountId,
    };

    const id = messageQueue.enqueue('sequence_step', payload as unknown as Record<string, unknown>, {
      priority: 7, // Higher priority than campaign messages
      maxAttempts: 3,
      delayMs,
    });

    logger.info(`Queued sequence step`, { enrollmentId, stepId, delayMs, queueId: id });
    return id;
  }

  /**
   * Cancel all pending messages for a campaign
   */
  cancelCampaign(campaignId: string): number {
    const cancelled = messageQueue.cancelAll({
      type: 'campaign_message',
      payloadMatch: { campaignId },
    });

    this.campaignProgress.delete(campaignId);
    logger.info(`Cancelled ${cancelled} pending messages for campaign ${campaignId}`);

    return cancelled;
  }

  /**
   * Get campaign progress
   */
  getCampaignProgress(campaignId: string): { sent: number; failed: number; total: number; pending: number } | null {
    const progress = this.campaignProgress.get(campaignId);
    if (!progress) return null;

    const pending = messageQueue.getItemsByPayload({ campaignId }).length;
    return { ...progress, pending };
  }

  /**
   * Select account based on rotation strategy
   */
  private selectAccount(
    accounts: string[],
    usage: Map<string, number>,
    strategy: 'round_robin' | 'random' | 'least_used'
  ): string {
    if (accounts.length === 1) return accounts[0];

    switch (strategy) {
      case 'random':
        return accounts[Math.floor(Math.random() * accounts.length)];

      case 'least_used':
      case 'round_robin':
      default:
        // Find account with lowest usage
        let minUsage = Infinity;
        let selectedAccount = accounts[0];
        for (const accountId of accounts) {
          const accountUsage = usage.get(accountId) || 0;
          if (accountUsage < minUsage) {
            minUsage = accountUsage;
            selectedAccount = accountId;
          }
        }
        return selectedAccount;
    }
  }

  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
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

    this.campaignProgress.delete(campaignId);
    logger.info(`Campaign ${campaignId} completed`);
    this.wsHub.emitCampaignStatus(campaignId, 'completed', 'All messages sent');
  }

  /**
   * Handle failed campaign message (called when max retries exceeded)
   */
  handleCampaignMessageFailed(payload: CampaignMessagePayload, error: string): void {
    const { campaignId, groupId, groupTitle } = payload;

    // Update progress
    const progress = this.campaignProgress.get(campaignId);
    if (progress) {
      progress.failed++;
      this.campaignProgress.set(campaignId, progress);
    }

    // Update campaign_groups status
    supabase
      .from('campaign_groups')
      .update({
        status: 'failed',
        error_message: error,
      })
      .eq('campaign_id', campaignId)
      .eq('group_id', groupId)
      .then(() => {
        logger.error(`Campaign message to ${groupTitle} permanently failed`, { error });
      });
  }
}

// Export factory function
export function createQueueProcessor(tgManager: TgAccountManager, wsHub: WebSocketHub): QueueProcessor {
  return new QueueProcessor(tgManager, wsHub);
}
