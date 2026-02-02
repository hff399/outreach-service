import { Cron } from 'croner';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { TgAccountManager } from '../services/tg-account-manager.js';
import { WebSocketHub } from '../services/websocket-hub.js';
import { CampaignService } from '../services/campaign-service.js';
import type { TgAccountRow, TgAccountUpdate } from '../lib/db-helpers.js';
import type { TgAccount } from '@outreach/shared/types/entities.js';
// Note: Sequence processing is now handled by sequence-scheduler.ts (started in index.ts)

const logger = createLogger('JobScheduler');

export class JobScheduler {
  private jobs: Cron[] = [];
  private campaignService: CampaignService;

  constructor(
    private tgManager: TgAccountManager,
    private wsHub: WebSocketHub
  ) {
    this.campaignService = new CampaignService(tgManager, wsHub);
  }

  start(): void {
    // Note: Sequence steps are processed by startSequenceScheduler() in index.ts

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
        .update({ messages_sent_today: 0 } as TgAccountUpdate)
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
        const typedAccount = account as Pick<TgAccountRow, 'id' | 'phone' | 'status'>;
        const isConnected = this.tgManager.isConnected(typedAccount.id);

        if (!isConnected) {
          logger.warn(`Account ${typedAccount.phone} disconnected, attempting reconnect...`);

          // Fetch full account data for reconnection
          const { data: fullAccount } = await supabase
            .from('tg_accounts')
            .select('*')
            .eq('id', typedAccount.id)
            .single();

          if (fullAccount?.session_string) {
            await this.tgManager.connectAccount(fullAccount as TgAccount);
          }
        }

        // Emit status update
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
}
