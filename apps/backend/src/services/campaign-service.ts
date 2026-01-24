import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { TgAccountManager } from './tg-account-manager.js';
import { WebSocketHub } from './websocket-hub.js';
import { applyTemplate } from '@shared/utils/index.js';
import type { Campaign, TgGroup, MessageTemplate } from '@shared/types/entities.js';

const logger = createLogger('CampaignService');

type ScheduleConfig = {
  min_delay_seconds?: number;
  max_delay_seconds?: number;
  randomize_delay?: boolean;
  account_rotation?: 'round_robin' | 'random' | 'least_used';
};

export class CampaignService {
  private accountUsageCount: Map<string, number> = new Map();
  private runningCampaigns: Set<string> = new Set();

  constructor(
    private tgManager: TgAccountManager,
    private wsHub: WebSocketHub
  ) {}

  /**
   * Execute campaign - sends 1 message per group with configurable delays
   */
  async executeCampaign(campaignId: string): Promise<void> {
    if (this.runningCampaigns.has(campaignId)) {
      logger.warn(`Campaign ${campaignId} is already running`);
      return;
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
        return;
      }

      if (campaign.status !== 'active') {
        logger.warn(`Campaign ${campaignId} is not active`);
        return;
      }

      const scheduleConfig = (campaign.schedule_config || {}) as ScheduleConfig;

      // Get groups to send to
      const groups = await this.getTargetGroups(campaign as Campaign);
      if (groups.length === 0) {
        logger.info(`No groups remaining for campaign ${campaignId}`);
        await this.completeCampaign(campaignId);
        return;
      }

      // Get available accounts (connected ones from assigned list)
      const connectedAccounts = this.tgManager.getConnectedAccounts()
        .filter((id) => campaign.assigned_accounts.includes(id));

      if (connectedAccounts.length === 0) {
        logger.error(`No connected accounts for campaign ${campaignId}`);
        return;
      }

      const template = campaign.message_templates as MessageTemplate | null;
      const messageText = template?.content || campaign.custom_message || '';

      if (!messageText) {
        logger.error(`Campaign ${campaignId} has no message content`);
        return;
      }

      let messagesSent = 0;
      let messagesFailed = 0;

      // Calculate delay between messages (default 1 minute = 60 seconds)
      const minDelayMs = (scheduleConfig.min_delay_seconds || 60) * 1000;
      const maxDelayMs = (scheduleConfig.max_delay_seconds || 120) * 1000;
      const randomizeDelay = scheduleConfig.randomize_delay !== false;

      logger.info(`Starting campaign ${campaignId}: ${groups.length} groups, delay ${minDelayMs/1000}-${maxDelayMs/1000}s`);

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];

        // Check if campaign is still active
        const { data: currentCampaign } = await supabase
          .from('campaigns')
          .select('status')
          .eq('id', campaignId)
          .single();

        if (currentCampaign?.status !== 'active') {
          logger.info(`Campaign ${campaignId} stopped`);
          break;
        }

        // Select account based on rotation strategy
        const accountId = this.selectAccount(connectedAccounts, scheduleConfig.account_rotation || 'round_robin');

        try {
          // Apply template variables
          const text = applyTemplate(messageText, {
            group_name: group.title,
          });

          // Send message to group
          await this.tgManager.sendToGroup(accountId, group.username || group.tg_id, text);

          // Update campaign_groups status
          await supabase
            .from('campaign_groups')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              account_id: accountId,
            })
            .eq('campaign_id', campaignId)
            .eq('group_id', group.id);

          messagesSent++;
          this.incrementAccountUsage(accountId);

          logger.info(`[${messagesSent}/${groups.length}] Sent to ${group.title} via account ${accountId.slice(0, 8)}`);

          // Emit progress via WebSocket
          this.wsHub.emitCampaignProgress(campaignId, {
            campaign_id: campaignId,
            total_groups: groups.length,
            messages_sent: messagesSent,
            messages_failed: messagesFailed,
            current_group: group.title,
            progress_percent: Math.round((messagesSent / groups.length) * 100),
          });

        } catch (error) {
          logger.error(`Failed to send to group ${group.title}`, error);

          await supabase
            .from('campaign_groups')
            .update({
              status: 'failed',
              error_message: (error as Error).message,
            })
            .eq('campaign_id', campaignId)
            .eq('group_id', group.id);

          messagesFailed++;
        }

        // Update campaign stats periodically
        if (messagesSent % 5 === 0 || i === groups.length - 1) {
          await this.updateCampaignStats(campaignId, groups.length, messagesSent, messagesFailed);
        }

        // Delay before next message (except for the last one)
        if (i < groups.length - 1) {
          const delay = randomizeDelay
            ? this.randomBetween(minDelayMs, maxDelayMs)
            : minDelayMs;

          logger.info(`Waiting ${Math.round(delay / 1000)}s before next message...`);
          await this.sleep(delay);
        }
      }

      // Final stats update
      await this.updateCampaignStats(campaignId, groups.length, messagesSent, messagesFailed);

      // Check if campaign is complete
      const remainingGroups = await this.getTargetGroups(campaign as Campaign);
      if (remainingGroups.length === 0) {
        await this.completeCampaign(campaignId);
      }

      logger.info(`Campaign ${campaignId} batch completed: ${messagesSent} sent, ${messagesFailed} failed`);

    } finally {
      this.runningCampaigns.delete(campaignId);
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
        // Find account with lowest usage count
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
        // Find account with lowest usage for round-robin effect
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
    // First get groups from campaign_groups that haven't been sent yet
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

    logger.info(`Campaign ${campaignId} completed`);
  }

  async pauseCampaign(campaignId: string): Promise<void> {
    await supabase
      .from('campaigns')
      .update({ status: 'paused' })
      .eq('id', campaignId);
  }

  async resumeCampaign(campaignId: string): Promise<void> {
    await supabase
      .from('campaigns')
      .update({ status: 'active' })
      .eq('id', campaignId);
  }

  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
