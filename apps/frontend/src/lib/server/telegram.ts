import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage, NewMessageEvent } from 'telegram/events/index.js';
import { Api } from 'telegram/tl/index.js';
import bigInt from 'big-integer';

import { config } from './config';
import { supabase } from './supabase';
import { createLogger } from './logger';
import { messageQueue } from './message-queue';

const logger = createLogger('TelegramManager');

type TgClientEntry = {
  client: TelegramClient;
  accountId: string;
  phone: string;
  isConnected: boolean;
  connectedAt?: number;
};

class TelegramManager {
  private clients: Map<string, TgClientEntry> = new Map();
  private messageHandlers: Map<string, (event: NewMessageEvent) => void> = new Map();
  private initialized = false;
  private initializing = false;

  async initialize(): Promise<void> {
    if (this.initialized || this.initializing) return;
    this.initializing = true;

    try {
      const { data: accounts, error } = await supabase
        .from('tg_accounts')
        .select('*')
        .not('session_string', 'is', null)
        .neq('status', 'banned');

      if (error) throw error;

      logger.info(`Found ${accounts?.length || 0} accounts with session strings`);

      for (const account of accounts || []) {
        if (account.session_string) {
          try {
            await this.connectAccount(account);
          } catch (err) {
            logger.error(`Failed to connect account ${account.phone}`, err);
          }
        }
      }

      this.initialized = true;

      // Start message queue processor
      messageQueue.start(1000);

      // Register processors
      this.registerProcessors();

    } finally {
      this.initializing = false;
    }
  }

  private registerProcessors(): void {
    messageQueue.registerProcessor('campaign_message', async (item) => {
      const payload = item.payload as { campaignId: string; groupUsername: string; groupTitle: string; accountId: string; messageText: string };

      const { data: campaign } = await supabase.from('campaigns').select('status').eq('id', payload.campaignId).single();
      if (campaign?.status !== 'active') return;

      if (!this.isConnected(payload.accountId)) {
        throw new Error(`Account ${payload.accountId} is not connected`);
      }

      await this.sendToGroup(payload.accountId, payload.groupUsername, payload.messageText);
      logger.info(`Sent campaign message to ${payload.groupTitle}`);
    });

    messageQueue.registerProcessor('sequence_step', async (item) => {
      const payload = item.payload as { enrollmentId: string; stepId: string };
      // Import dynamically to avoid circular dependency
      const { executeSequenceStep } = await import('./sequence-executor');
      await executeSequenceStep(payload.enrollmentId, payload.stepId);
    });
  }

  async connectAccount(account: { id: string; phone: string; session_string: string; proxy_config?: unknown }): Promise<boolean> {
    try {
      const session = new StringSession(account.session_string || '');

      const client = new TelegramClient(
        session,
        config.telegram.apiId,
        config.telegram.apiHash,
        {
          connectionRetries: 3,
          retryDelay: 2000,
          autoReconnect: true,
          deviceModel: 'Samsung Galaxy S23',
          appVersion: '10.6.2',
          systemVersion: 'Android 14',
        }
      );

      await client.connect();

      if (!await client.isUserAuthorized()) {
        logger.warn(`Account ${account.phone} not authorized`);
        await supabase.from('tg_accounts').update({ status: 'auth_required' }).eq('id', account.id);
        return false;
      }

      const me = await client.getMe() as Api.User;

      await supabase.from('tg_accounts').update({
        username: me.username || null,
        first_name: me.firstName || null,
        last_name: me.lastName || null,
        status: 'active',
        last_active_at: new Date().toISOString(),
      }).eq('id', account.id);

      this.setupMessageHandler(account.id, client);

      this.clients.set(account.id, {
        client,
        accountId: account.id,
        phone: account.phone,
        isConnected: true,
        connectedAt: Date.now(),
      });

      logger.info(`Connected account: ${account.phone}`);
      return true;
    } catch (error) {
      const err = error as Error & { errorMessage?: string };
      logger.error(`Failed to connect account ${account.phone}`, error);

      if (['SESSION_REVOKED', 'AUTH_KEY_UNREGISTERED', 'AUTH_KEY_DUPLICATED'].includes(err.errorMessage || '')) {
        await supabase.from('tg_accounts').update({ session_string: null, status: 'auth_required' }).eq('id', account.id);
      } else {
        await supabase.from('tg_accounts').update({ status: 'inactive' }).eq('id', account.id);
      }
      return false;
    }
  }

  private setupMessageHandler(accountId: string, client: TelegramClient): void {
    const handler = async (event: NewMessageEvent) => {
      try {
        const message = event.message;
        if (!message.isPrivate) return;

        const senderId = message.senderId?.toString();
        if (!senderId) return;

        const sender = await message.getSender() as Api.User | undefined;
        const senderInfo = sender ? {
          id: senderId,
          username: sender.username || null,
          firstName: sender.firstName || null,
          lastName: sender.lastName || null,
          accessHash: sender.accessHash?.toString() || null,
        } : { id: senderId, username: null, firstName: null, lastName: null, accessHash: null };

        // Get or create lead
        const { data: existingLead } = await supabase
          .from('leads')
          .select('id, custom_fields, assigned_account_id')
          .eq('tg_user_id', senderId)
          .single();

        let leadId = existingLead?.id;

        if (!leadId) {
          const { data: defaultStatus } = await supabase.from('lead_statuses').select('id').eq('is_default', true).single();
          const { data: newLead } = await supabase.from('leads').insert({
            tg_user_id: senderId,
            username: senderInfo.username,
            first_name: senderInfo.firstName,
            last_name: senderInfo.lastName,
            assigned_account_id: accountId,
            status_id: defaultStatus?.id,
            custom_fields: senderInfo.accessHash ? { tg_access_hash: senderInfo.accessHash } : {},
          }).select().single();
          leadId = newLead?.id;
        } else if (senderInfo.accessHash && existingLead) {
          const existingFields = (existingLead.custom_fields as Record<string, unknown>) || {};
          await supabase.from('leads').update({
            custom_fields: { ...existingFields, tg_access_hash: senderInfo.accessHash },
            ...(existingLead.assigned_account_id ? {} : { assigned_account_id: accountId }),
          }).eq('id', leadId);
        }

        // Save message
        await supabase.from('messages').insert({
          lead_id: leadId,
          account_id: accountId,
          direction: 'incoming',
          type: 'text',
          content: message.text || '',
          status: 'delivered',
          tg_message_id: message.id.toString(),
          sent_at: new Date(message.date * 1000).toISOString(),
        });

        await supabase.from('leads').update({ last_message_at: new Date().toISOString() }).eq('id', leadId);

        logger.info('New message received', { leadId, from: senderInfo.username || senderId });

        // Check sequences
        if (leadId) {
          const { checkAndEnrollSequences } = await import('./sequence-trigger');
          const { data: lead } = await supabase.from('leads').select('*').eq('id', leadId).single();
          if (lead) {
            checkAndEnrollSequences(lead, message.text || '', accountId).catch(err => {
              logger.error('Failed to check sequences', err);
            });
          }
        }
      } catch (error) {
        logger.error('Error handling message', error);
      }
    };

    const existingHandler = this.messageHandlers.get(accountId);
    if (existingHandler) {
      client.removeEventHandler(existingHandler, new NewMessage({ incoming: true }));
    }

    client.addEventHandler(handler, new NewMessage({ incoming: true }));
    this.messageHandlers.set(accountId, handler);
  }

  async sendMessage(accountId: string, userId: string, text: string, accessHash?: string): Promise<Api.Message | null> {
    const entry = this.clients.get(accountId);
    if (!entry?.isConnected) throw new Error('Account not connected');

    let peer: Api.InputPeerUser | string = userId;
    if (accessHash) {
      try {
        peer = new Api.InputPeerUser({ userId: bigInt(userId), accessHash: bigInt(accessHash) });
      } catch { peer = userId; }
    }

    const result = await entry.client.sendMessage(peer, { message: text });
    return result;
  }

  async sendToGroup(accountId: string, groupUsername: string, text: string): Promise<Api.Message | null> {
    const entry = this.clients.get(accountId);
    if (!entry?.isConnected) throw new Error('Account not connected');

    const result = await entry.client.sendMessage(groupUsername, { message: text });

    await supabase.from('tg_accounts').update({
      messages_sent_today: (entry as unknown as { account?: { messages_sent_today?: number } }).account?.messages_sent_today || 0 + 1,
      last_active_at: new Date().toISOString(),
    }).eq('id', accountId);

    return result;
  }

  async sendTypingStatus(accountId: string, userId: string, accessHash?: string): Promise<void> {
    const entry = this.clients.get(accountId);
    if (!entry?.isConnected) return;

    try {
      let peer: Api.TypeInputPeer;
      if (accessHash) {
        peer = new Api.InputPeerUser({ userId: bigInt(userId), accessHash: bigInt(accessHash) });
      } else {
        peer = await entry.client.getInputEntity(userId);
      }
      await entry.client.invoke(new Api.messages.SetTyping({ peer, action: new Api.SendMessageTypingAction() }));
    } catch { /* ignore */ }
  }

  async markAsRead(accountId: string, userId: string, accessHash?: string): Promise<void> {
    const entry = this.clients.get(accountId);
    if (!entry?.isConnected) return;

    try {
      let peer: Api.TypeInputPeer;
      if (accessHash) {
        peer = new Api.InputPeerUser({ userId: bigInt(userId), accessHash: bigInt(accessHash) });
      } else {
        peer = await entry.client.getInputEntity(userId);
      }
      await entry.client.invoke(new Api.messages.ReadHistory({ peer, maxId: 0 }));
    } catch { /* ignore */ }
  }

  isConnected(accountId: string): boolean {
    return this.clients.get(accountId)?.isConnected ?? false;
  }

  getConnectedAccounts(): string[] {
    return Array.from(this.clients.entries())
      .filter(([, entry]) => entry.isConnected)
      .map(([id]) => id);
  }

  getClient(accountId: string): TelegramClient | null {
    return this.clients.get(accountId)?.client ?? null;
  }

  // QR Auth methods
  private qrAuthState: Map<string, {
    client: TelegramClient;
    qrUrl?: string;
    expiresAt?: number;
    status: 'pending' | 'waiting' | 'success' | '2fa_required';
    passwordResolver?: (password: string) => void;
  }> = new Map();

  async startQrAuth(accountId: string): Promise<{ qrUrl: string; expiresAt: number }> {
    const existing = this.qrAuthState.get(accountId);
    if (existing?.client) {
      try { await existing.client.disconnect(); } catch { /* ignore */ }
    }
    this.qrAuthState.delete(accountId);

    const session = new StringSession('');
    const client = new TelegramClient(session, config.telegram.apiId, config.telegram.apiHash, {
      connectionRetries: 5,
      retryDelay: 1000,
      autoReconnect: true,
    });

    const state: { client: TelegramClient; qrUrl?: string; expiresAt?: number; status: 'pending' | 'waiting' | 'success' | '2fa_required'; passwordResolver?: (password: string) => void } = { client, status: 'pending' };
    this.qrAuthState.set(accountId, state);

    await client.connect();

    client.signInUserWithQrCode(
      { apiId: config.telegram.apiId, apiHash: config.telegram.apiHash },
      {
        qrCode: async (qrCode) => {
          state.qrUrl = `tg://login?token=${qrCode.token.toString('base64url')}`;
          state.expiresAt = qrCode.expires;
          state.status = 'waiting';
        },
        password: async () => {
          state.status = '2fa_required';
          return new Promise<string>((resolve) => { state.passwordResolver = resolve; });
        },
        onError: async () => true,
      }
    ).then(async (user) => {
      state.status = 'success';
      const sessionString = (client.session as StringSession).save();
      const me = user as Api.User;

      await supabase.from('tg_accounts').update({
        session_string: sessionString,
        status: 'active',
        username: me.username || null,
        first_name: me.firstName || null,
        last_name: me.lastName || null,
        last_active_at: new Date().toISOString(),
      }).eq('id', accountId);

      this.clients.set(accountId, { client, accountId, phone: '', isConnected: true, connectedAt: Date.now() });
      this.setupMessageHandler(accountId, client);
      this.qrAuthState.delete(accountId);
    }).catch(() => {
      this.qrAuthState.delete(accountId);
    });

    // Wait for QR code
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (state.qrUrl) break;
    }

    if (!state.qrUrl) throw new Error('Failed to generate QR code');
    return { qrUrl: state.qrUrl, expiresAt: state.expiresAt || 0 };
  }

  async pollQrAuth(accountId: string): Promise<{ status: string; qrUrl?: string; expiresAt?: number }> {
    if (this.clients.get(accountId)?.isConnected) return { status: 'success' };
    const state = this.qrAuthState.get(accountId);
    if (!state) throw new Error('QR_EXPIRED');
    return { status: state.status, qrUrl: state.qrUrl, expiresAt: state.expiresAt };
  }

  async completeQrAuth2FA(accountId: string, password: string): Promise<boolean> {
    const state = this.qrAuthState.get(accountId);
    if (!state?.passwordResolver) throw new Error('No pending 2FA request');
    state.passwordResolver(password);

    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 200));
      if (this.clients.get(accountId)?.isConnected) return true;
      if (!this.qrAuthState.has(accountId)) throw new Error('Authentication failed');
    }
    throw new Error('Authentication timeout');
  }

  async getHealthStatus(): Promise<Array<{ id: string; phone: string; status: string; isConnected: boolean }>> {
    const { data: accounts } = await supabase.from('tg_accounts').select('id, phone, status');
    return (accounts || []).map((account) => ({
      id: account.id,
      phone: account.phone,
      status: account.status,
      isConnected: this.isConnected(account.id),
    }));
  }
}

// Singleton - persists across API route calls
const globalForTelegram = globalThis as unknown as { telegramManager: TelegramManager | undefined };
export const telegramManager = globalForTelegram.telegramManager ?? new TelegramManager();
if (process.env.NODE_ENV !== 'production') globalForTelegram.telegramManager = telegramManager;

// DISABLED: Telegram client connections are managed by the backend service only.
// Having both frontend and backend connect causes AUTH_KEY_DUPLICATED errors.
// All Telegram operations should proxy through the backend API.
//
// Auto-initialize on first import (server-side only)
// if (typeof window === 'undefined') {
//   telegramManager.initialize().catch(err => {
//     logger.error('Failed to initialize Telegram manager', err);
//   });
//
//   // Import scheduler to auto-start it
//   import('./scheduler').catch(() => {
//     // Scheduler module loads and auto-starts
//   });
// }
