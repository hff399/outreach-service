import { Cron } from 'croner';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { TgAccountManager } from '../services/tg-account-manager.js';
import { WebSocketHub } from '../services/websocket-hub.js';
import { CampaignService } from '../services/campaign-service.js';
import { messageQueue, type QueueItem, type CampaignMessagePayload } from '../services/message-queue.js';
import type { TgAccountRow, TgAccountUpdate } from '../lib/db-helpers.js';
import type { TgAccount } from '@outreach/shared/types/entities.js';

const logger = createLogger('JobScheduler');

export class JobScheduler {
  private jobs: Cron[] = [];
  private campaignService: CampaignService;

  constructor(
    private tgManager: TgAccountManager,
    private wsHub: WebSocketHub
  ) {
    this.campaignService = new CampaignService(tgManager, wsHub);
    this.registerQueueProcessors();
  }

  /**
   * Register queue processors for different message types
   */
  private registerQueueProcessors(): void {
    // Register campaign message processor
    messageQueue.registerProcessor('campaign_message', async (item: QueueItem) => {
      const payload = item.payload as unknown as CampaignMessagePayload;
      await this.processCampaignMessage(payload);
    });

    // Register sequence step processor (already handled in sequence-scheduler.ts)
    // The sequence_step type is registered when importing sequence-scheduler

    logger.info('Queue processors registered');
  }

  /**
   * Process a campaign message - send to group
   */
  private async processCampaignMessage(payload: CampaignMessagePayload): Promise<void> {
    const { campaignId, groupUsername, groupTitle, accountId, messageText } = payload;

    logger.info(`Processing campaign message for group ${groupTitle}`, { campaignId, accountId });

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

    // Send message to group
    await this.tgManager.sendToGroup(accountId, groupUsername, messageText);

    logger.info(`Sent campaign message to ${groupTitle} via account ${accountId.slice(0, 8)}`);
  }

  start(): void {
    // Start the message queue processor
    messageQueue.start(1000); // Process every 1 second
    logger.info('Message queue processor started');

    // Reset daily message counters at midnight UTC
    this.jobs.push(
      new Cron('0 0 * * *', async () => {
        await this.resetDailyCounters();
      })
    );

    // Health check every 5 minutes
    this.jobs.push(
      new Cron('*/5 * * * *', async () => {
        await this.healthCheck();
      })
    );

    // Log queue stats every minute
    this.jobs.push(
      new Cron('* * * * *', () => {
        const stats = messageQueue.getStats();
        if (stats.total > 0 || stats.processed > 0) {
          logger.info('Queue stats', stats);
        }
      })
    );

    logger.info('Job scheduler started');
  }

  stop(): void {
    // Stop the message queue
    messageQueue.stop();

    for (const job of this.jobs) {
      job.stop();
    }
    this.jobs = [];
    logger.info('Job scheduler stopped');
  }

  private async resetDailyCounters(): Promise<void> {
    try {
      await supabase
        .from('tg_accounts')
        .update({ messages_sent_today: 0 } as TgAccountUpdate)
        .neq('id', '00000000-0000-0000-0000-000000000000');

      logger.info('Reset daily message counters');
    } catch (error) {
      logger.error('Failed to reset daily counters', error);
    }
  }

  private async healthCheck(): Promise<void> {
    try {
      const { data: accounts } = await supabase
        .from('tg_accounts')
        .select('id, phone, status')
        .eq('status', 'active');

      if (!accounts?.length) return;

      for (const account of accounts) {
        const typedAccount = account as Pick<TgAccountRow, 'id' | 'phone' | 'status'>;
        const isConnected = this.tgManager.isConnected(typedAccount.id);

        if (!isConnected) {
          logger.warn(`Account ${typedAccount.phone} disconnected, attempting reconnect...`);

          const { data: fullAccount } = await supabase
            .from('tg_accounts')
            .select('*')
            .eq('id', typedAccount.id)
            .single();

          if (fullAccount?.session_string) {
            await this.tgManager.connectAccount(fullAccount as TgAccount);
          }
        }

        this.wsHub.emitAccountStatus(typedAccount.id, typedAccount.status, isConnected);
      }
    } catch (error) {
      logger.error('Health check failed', error);
    }
  }

  // Public method to manually trigger campaign
  async triggerCampaign(campaignId: string): Promise<void> {
    await this.campaignService.executeCampaign(campaignId);
  }

  // Public method to pause campaign
  async pauseCampaign(campaignId: string): Promise<void> {
    await this.campaignService.pauseCampaign(campaignId);
  }

  // Validate campaign before starting
  async validateCampaign(campaignId: string) {
    return this.campaignService.validateCampaign(campaignId);
  }

  // Restart campaign - reset all groups to pending
  async restartCampaign(campaignId: string) {
    return this.campaignService.restartCampaign(campaignId);
  }

  // Check if campaign is running
  isCampaignRunning(campaignId: string): boolean {
    return this.campaignService.isRunning(campaignId);
  }

  // Get queue statistics
  getQueueStats() {
    return messageQueue.getStats();
  }
}
