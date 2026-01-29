import { Cron } from 'croner';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { TgAccountManager } from '../services/tg-account-manager.js';
import { WebSocketHub } from '../services/websocket-hub.js';
import { CampaignService } from '../services/campaign-service.js';
import { SequenceService } from '../services/sequence-service.js';

const logger = createLogger('JobScheduler');

export class JobScheduler {
  private jobs: Cron[] = [];
  private campaignService: CampaignService;
  private sequenceService: SequenceService;

  constructor(
    private tgManager: TgAccountManager,
    private wsHub: WebSocketHub
  ) {
    this.campaignService = new CampaignService(tgManager, wsHub);
    this.sequenceService = new SequenceService(tgManager, wsHub);
  }

  start(): void {
    // Process sequence steps every 30 seconds
    this.jobs.push(
      new Cron('*/30 * * * * *', async () => {
        await this.sequenceService.processScheduledSteps();
      })
    );

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

    logger.info('Job scheduler started');
  }

  stop(): void {
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
        .update({ messages_sent_today: 0 })
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Update all

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
        const isConnected = this.tgManager.isConnected(account.id);

        if (!isConnected) {
          logger.warn(`Account ${account.phone} disconnected, attempting reconnect...`);

          // Fetch full account data for reconnection
          const { data: fullAccount } = await supabase
            .from('tg_accounts')
            .select('*')
            .eq('id', account.id)
            .single();

          if (fullAccount?.session_string) {
            await this.tgManager.connectAccount(fullAccount as never);
          }
        }

        // Emit status update
        this.wsHub.emitAccountStatus(account.id, account.status, isConnected);
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
}
