import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage, NewMessageEvent } from 'telegram/events/index.js';
import { Api } from 'telegram/tl/index.js';
import bigInt from 'big-integer';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';

import { appConfig } from '../lib/config.js';
import { supabase } from '../lib/supabase.js';
import { createLogger } from '../lib/logger.js';
import { wsHub } from './websocket-hub.js';
import { checkAndEnrollSequences } from './sequence-trigger.js';
import type { TgAccount, TgAccountStatus, Lead } from '@shared/types/entities.js';

const logger = createLogger('TgAccountManager');

type ProxyConfig = {
  type: 'socks5' | 'http' | 'mtproto';
  host: string;
  port: number;
  username?: string;
  password?: string;
};

type TgClientEntry = {
  client: TelegramClient;
  account: TgAccount;
  isConnected: boolean;
};

function buildProxyAgent(config: ProxyConfig) {
  const auth = config.username && config.password
    ? `${config.username}:${config.password}@`
    : '';

  if (config.type === 'socks5') {
    return new SocksProxyAgent(`socks5://${auth}${config.host}:${config.port}`);
  }
  return new HttpsProxyAgent(`http://${auth}${config.host}:${config.port}`);
}

export class TgAccountManager {
  private clients: Map<string, TgClientEntry> = new Map();
  private messageHandlers: Map<string, (event: NewMessageEvent) => void> = new Map();
  private onlineHeartbeatInterval: NodeJS.Timeout | null = null;
  private readonly ONLINE_HEARTBEAT_MS = 25000; // Send heartbeat every 25 seconds to stay online

  async initializeAllAccounts(retries = 3): Promise<void> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Fetch all accounts that have a session string (try to reconnect even auth_required)
        const { data: accounts, error } = await supabase
          .from('tg_accounts')
          .select('*')
          .not('session_string', 'is', null)
          .neq('status', 'banned');

        if (error) {
          throw error;
        }

        logger.info(`Found ${accounts?.length || 0} accounts with session strings`);

        for (const account of accounts || []) {
          if (account.session_string) {
            try {
              await this.connectAccount(account as TgAccount);
            } catch (err) {
              logger.error(`Failed to connect account ${account.phone}`, err);
            }
          }
        }

        // Start online status heartbeat after connecting accounts
        this.startOnlineHeartbeat();

        return; // Success, exit
      } catch (error) {
        logger.error(`Failed to fetch accounts (attempt ${attempt}/${retries})`, error);

        if (attempt < retries) {
          // Wait before retrying (exponential backoff)
          const delay = attempt * 2000;
          logger.info(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    logger.error('Failed to initialize accounts after all retries');
  }

  async connectAccount(account: TgAccount): Promise<boolean> {
    try {
      const session = new StringSession(account.session_string || '');
      const proxyConfig = account.proxy_config as ProxyConfig | null;

      const clientOptions: ConstructorParameters<typeof TelegramClient>[3] = {
        connectionRetries: 3,
        retryDelay: 2000,
        autoReconnect: true,
        deviceModel: 'Samsung Galaxy S23',
        appVersion: '10.6.2',
        systemVersion: 'Android 14',
        langCode: 'en',
      };

      // Add proxy if configured
      if (proxyConfig && proxyConfig.host) {
        if (proxyConfig.type === 'mtproto') {
          // MTProto proxy is handled differently
          clientOptions.proxy = {
            ip: proxyConfig.host,
            port: proxyConfig.port,
            secret: proxyConfig.password || '',
            socksType: undefined,
            timeout: 10,
          };
        } else {
          // Use agent for SOCKS5/HTTP proxies
          (clientOptions as Record<string, unknown>).agent = buildProxyAgent(proxyConfig);
        }
        logger.info(`Using ${proxyConfig.type} proxy for ${account.phone}: ${proxyConfig.host}:${proxyConfig.port}`);
      }

      const client = new TelegramClient(
        session,
        appConfig.telegram.apiId,
        appConfig.telegram.apiHash,
        clientOptions
      );

      await client.connect();

      if (!await client.isUserAuthorized()) {
        logger.warn(`Account ${account.phone} not authorized`);
        await this.updateAccountStatus(account.id, 'auth_required');
        return false;
      }

      // Get user info
      const me = await client.getMe();

      // Update account info
      await supabase
        .from('tg_accounts')
        .update({
          username: (me as Api.User).username || null,
          first_name: (me as Api.User).firstName || null,
          last_name: (me as Api.User).lastName || null,
          status: 'active',
          last_active_at: new Date().toISOString(),
        })
        .eq('id', account.id);

      // Setup message handler
      this.setupMessageHandler(account.id, client);

      this.clients.set(account.id, {
        client,
        account: {
          ...account,
          status: 'active',
        },
        isConnected: true,
      });

      // Set online status immediately after connecting
      await this.setOnlineStatus(account.id, true);

      logger.info(`Connected account: ${account.phone}`);
      return true;
    } catch (error) {
      const err = error as Error & { errorMessage?: string };
      logger.error(`Failed to connect account ${account.phone}`, error);

      // Handle session revocation - clear the invalid session
      if (err.errorMessage === 'SESSION_REVOKED' || err.errorMessage === 'AUTH_KEY_UNREGISTERED') {
        logger.warn(`Session revoked for ${account.phone}, clearing session and requiring re-auth`);
        await supabase
          .from('tg_accounts')
          .update({
            session_string: null,
            status: 'auth_required',
          })
          .eq('id', account.id);
        return false;
      }

      await this.updateAccountStatus(account.id, 'inactive');
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

        // Get sender info including access_hash for future messaging
        const sender = await message.getSender();
        const senderUser = sender as Api.User | undefined;
        const senderInfo = senderUser ? {
          id: senderId,
          username: senderUser.username || null,
          firstName: senderUser.firstName || null,
          lastName: senderUser.lastName || null,
          accessHash: senderUser.accessHash?.toString() || null,
        } : { id: senderId, username: null, firstName: null, lastName: null, accessHash: null };

        // Get or create lead
        const { data: existingLead } = await supabase
          .from('leads')
          .select('id, status_id')
          .eq('tg_user_id', senderId)
          .single();

        let leadId = existingLead?.id;

        // Create lead if doesn't exist
        if (!leadId) {
          // Get default status
          const { data: defaultStatus } = await supabase
            .from('lead_statuses')
            .select('id')
            .eq('is_default', true)
            .single();

          const { data: newLead } = await supabase
            .from('leads')
            .insert({
              tg_user_id: senderId,
              username: senderInfo.username,
              first_name: senderInfo.firstName,
              last_name: senderInfo.lastName,
              assigned_account_id: accountId,
              status_id: defaultStatus?.id,
              custom_fields: senderInfo.accessHash ? { tg_access_hash: senderInfo.accessHash } : {},
            })
            .select()
            .single();
          leadId = newLead?.id;
        } else if (senderInfo.accessHash) {
          // Update existing lead with access_hash if we have it
          await supabase
            .from('leads')
            .update({
              custom_fields: { tg_access_hash: senderInfo.accessHash },
            })
            .eq('id', leadId);
        }

        // Save message
        const { data: savedMessage } = await supabase
          .from('messages')
          .insert({
            lead_id: leadId,
            account_id: accountId,
            direction: 'incoming',
            type: this.getMediaType(message),
            content: message.text || '',
            status: 'delivered',
            tg_message_id: message.id.toString(),
            sent_at: new Date(message.date * 1000).toISOString(),
          })
          .select()
          .single();

        // Update lead's last_message_at
        await supabase
          .from('leads')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', leadId);

        // Emit to WebSocket for real-time updates
        wsHub.broadcast('message:incoming', {
          leadId,
          accountId,
          message: savedMessage,
          sender: senderInfo,
        });

        logger.debug('New private message saved', { leadId, messageId: savedMessage?.id });

        // Check and enroll in sequences
        if (leadId) {
          const { data: lead } = await supabase
            .from('leads')
            .select('*')
            .eq('id', leadId)
            .single();

          if (lead) {
            checkAndEnrollSequences(lead as Lead, message.text || '', accountId).catch((err) => {
              logger.error('Failed to check sequences', err);
            });
          }
        }
      } catch (error) {
        logger.error('Error handling message', error);
      }
    };

    client.addEventHandler(handler, new NewMessage({ incoming: true }));
    this.messageHandlers.set(accountId, handler);
  }

  private getMediaType(message: Api.Message): 'text' | 'video' | 'video_note' | 'voice' | 'photo' | 'document' | 'sticker' {
    if (message.video) return 'video';
    if (message.videoNote) return 'video_note';
    if (message.voice) return 'voice';
    if (message.photo) return 'photo';
    if (message.document) return 'document';
    if (message.sticker) return 'sticker';
    return 'text';
  }

  async startAuth(accountId: string, phone: string): Promise<{ phoneCodeHash: string }> {
    logger.info(`Starting auth for account ${accountId}, phone: ${phone}`);

    // Get account to check for proxy config
    const { data: account } = await supabase
      .from('tg_accounts')
      .select('proxy_config')
      .eq('id', accountId)
      .single();

    const proxyConfig = account?.proxy_config as ProxyConfig | null;
    const session = new StringSession('');

    const clientOptions: ConstructorParameters<typeof TelegramClient>[3] = {
      connectionRetries: 5,
      deviceModel: 'Outreach Service',
      appVersion: '1.0.0',
    };

    if (proxyConfig && proxyConfig.host && proxyConfig.type !== 'mtproto') {
      (clientOptions as Record<string, unknown>).agent = buildProxyAgent(proxyConfig);
      logger.info(`Using proxy for auth: ${proxyConfig.host}:${proxyConfig.port}`);
    }

    logger.info(`Creating TelegramClient with apiId: ${appConfig.telegram.apiId}`);

    const client = new TelegramClient(
      session,
      appConfig.telegram.apiId,
      appConfig.telegram.apiHash,
      clientOptions
    );

    logger.info('Connecting to Telegram...');
    await client.connect();
    logger.info('Connected to Telegram');

    logger.info(`Sending auth code to ${phone}...`);
    const result = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId: appConfig.telegram.apiId,
        apiHash: appConfig.telegram.apiHash,
        settings: new Api.CodeSettings({}),
      })
    );
    logger.info(`Auth code sent, phoneCodeHash received`);

    // Store client temporarily for auth flow
    this.clients.set(accountId, {
      client,
      account: { id: accountId, phone } as TgAccount,
      isConnected: false,
    });

    return { phoneCodeHash: result.phoneCodeHash };
  }

  async completeAuth(
    accountId: string,
    phone: string,
    code: string,
    phoneCodeHash: string,
    password?: string
  ): Promise<boolean> {
    const entry = this.clients.get(accountId);
    if (!entry) {
      throw new Error('Auth session not found');
    }

    try {
      await entry.client.invoke(
        new Api.auth.SignIn({
          phoneNumber: phone,
          phoneCodeHash,
          phoneCode: code,
        })
      );
    } catch (error: unknown) {
      if ((error as Error).message?.includes('SESSION_PASSWORD_NEEDED')) {
        if (!password) {
          throw new Error('2FA_REQUIRED');
        }

        const passwordResult = await entry.client.invoke(
          new Api.account.GetPassword()
        );

        // Handle 2FA
        await entry.client.invoke(
          new Api.auth.CheckPassword({
            password: await entry.client.computeSrpParams(
              passwordResult,
              password
            ),
          })
        );
      } else {
        throw error;
      }
    }

    // Save session
    const sessionString = (entry.client.session as StringSession).save();

    await supabase
      .from('tg_accounts')
      .update({
        session_string: sessionString,
        status: 'active',
        last_active_at: new Date().toISOString(),
      })
      .eq('id', accountId);

    entry.isConnected = true;
    this.setupMessageHandler(accountId, entry.client);

    // Set online status after successful auth
    await this.setOnlineStatus(accountId, true);

    // Ensure heartbeat is running
    this.startOnlineHeartbeat();

    logger.info(`Auth completed for account: ${phone}`);
    return true;
  }

  async sendMessage(
    accountId: string,
    userId: string,
    text: string,
    accessHash?: string
  ): Promise<Api.Message | null> {
    const entry = this.clients.get(accountId);
    if (!entry?.isConnected) {
      throw new Error('Account not connected');
    }

    // Try to use InputPeerUser with access_hash for reliable message delivery
    let peer: Api.InputPeerUser | string = userId;
    if (accessHash) {
      try {
        peer = new Api.InputPeerUser({
          userId: bigInt(userId),
          accessHash: bigInt(accessHash),
        });
      } catch {
        // Fallback to string userId if BigInt conversion fails
        peer = userId;
      }
    }

    const result = await entry.client.sendMessage(peer, { message: text });
    return result;
  }

  async sendMedia(
    accountId: string,
    userId: string,
    mediaPath: string,
    caption?: string,
    asVideoNote?: boolean,
    asVoice?: boolean,
    accessHash?: string
  ): Promise<Api.Message | null> {
    const entry = this.clients.get(accountId);
    if (!entry?.isConnected) {
      throw new Error('Account not connected');
    }

    // Try to use InputPeerUser with access_hash for reliable message delivery
    let peer: Api.InputPeerUser | string = userId;
    if (accessHash) {
      try {
        peer = new Api.InputPeerUser({
          userId: bigInt(userId),
          accessHash: bigInt(accessHash),
        });
      } catch {
        peer = userId;
      }
    }

    const sendOptions: Parameters<typeof entry.client.sendFile>[1] = {
      file: mediaPath,
      caption,
    };

    if (asVoice) {
      // Voice message - set voice note flag and attributes
      sendOptions.voiceNote = true;
      sendOptions.attributes = [
        new Api.DocumentAttributeAudio({
          voice: true,
          duration: 0, // Will be calculated by Telegram
          title: undefined,
          performer: undefined,
        }),
      ];
    } else if (asVideoNote) {
      // Video note (circle) - set video note flag and attributes
      sendOptions.videoNote = true;
      sendOptions.attributes = [
        new Api.DocumentAttributeVideo({
          roundMessage: true,
          duration: 0, // Will be calculated by Telegram
          w: 480,
          h: 480,
          supportsStreaming: true,
        }),
      ];
    }

    const result = await entry.client.sendFile(peer, sendOptions);

    return result;
  }

  async sendToGroup(
    accountId: string,
    groupUsername: string,
    text: string
  ): Promise<Api.Message | null> {
    const entry = this.clients.get(accountId);
    if (!entry?.isConnected) {
      throw new Error('Account not connected');
    }

    const result = await entry.client.sendMessage(groupUsername, { message: text });

    // Update message count
    await supabase
      .from('tg_accounts')
      .update({
        messages_sent_today: (entry.account.messages_sent_today || 0) + 1,
        last_active_at: new Date().toISOString(),
      })
      .eq('id', accountId);

    return result;
  }

  async disconnectAccount(accountId: string): Promise<void> {
    const entry = this.clients.get(accountId);
    if (entry) {
      await entry.client.disconnect();
      this.clients.delete(accountId);
      logger.info(`Disconnected account: ${entry.account.phone}`);
    }
  }

  async disconnectAll(): Promise<void> {
    // Stop the online heartbeat first
    this.stopOnlineHeartbeat();

    // Set all accounts offline before disconnecting
    await this.setAllOnlineStatus(false);

    for (const [accountId] of this.clients) {
      await this.disconnectAccount(accountId);
    }
  }

  private async updateAccountStatus(accountId: string, status: TgAccountStatus): Promise<void> {
    await supabase
      .from('tg_accounts')
      .update({ status })
      .eq('id', accountId);
  }

  async getHealthStatus(): Promise<Array<{
    id: string;
    phone: string;
    status: TgAccountStatus;
    isConnected: boolean;
  }>> {
    const { data: accounts } = await supabase
      .from('tg_accounts')
      .select('id, phone, status');

    return (accounts || []).map((account) => {
      const entry = this.clients.get(account.id);
      return {
        id: account.id,
        phone: account.phone,
        status: account.status as TgAccountStatus,
        isConnected: entry?.isConnected ?? false,
      };
    });
  }

  getClient(accountId: string): TelegramClient | null {
    return this.clients.get(accountId)?.client ?? null;
  }

  isConnected(accountId: string): boolean {
    return this.clients.get(accountId)?.isConnected ?? false;
  }

  getConnectedAccounts(): string[] {
    return Array.from(this.clients.entries())
      .filter(([, entry]) => entry.isConnected)
      .map(([id]) => id);
  }

  async sendTypingStatus(accountId: string, userId: string, accessHash?: string): Promise<void> {
    const entry = this.clients.get(accountId);
    if (!entry?.isConnected) {
      return; // Silently fail if not connected
    }

    try {
      // Use InputPeerUser with access_hash if available
      let peer: Api.TypeInputPeer;
      if (accessHash) {
        peer = new Api.InputPeerUser({
          userId: bigInt(userId),
          accessHash: bigInt(accessHash),
        });
      } else {
        // Without access_hash, try to get entity but don't fail if not found
        try {
          peer = await entry.client.getInputEntity(userId);
        } catch {
          // Can't find entity without access_hash, skip typing
          return;
        }
      }

      // Send typing action
      await entry.client.invoke(
        new Api.messages.SetTyping({
          peer,
          action: new Api.SendMessageTypingAction(),
        })
      );
    } catch (error) {
      // Typing status is not critical, just log and continue
      logger.debug(`Failed to send typing status`, error);
    }
  }

  async markAsRead(accountId: string, userId: string, accessHash?: string): Promise<void> {
    const entry = this.clients.get(accountId);
    if (!entry?.isConnected) {
      throw new Error('Account not connected');
    }

    try {
      // Use InputPeerUser with access_hash if available
      let peer: Api.TypeInputPeer;
      if (accessHash) {
        peer = new Api.InputPeerUser({
          userId: bigInt(userId),
          accessHash: bigInt(accessHash),
        });
      } else {
        peer = await entry.client.getInputEntity(userId);
      }

      // Mark messages as read
      await entry.client.invoke(
        new Api.messages.ReadHistory({
          peer,
          maxId: 0, // Mark all messages as read
        })
      );
    } catch (error) {
      logger.error(`Failed to mark messages as read`, error);
      // Don't throw - this is not critical
    }
  }

  /**
   * Set online status for a specific account
   */
  async setOnlineStatus(accountId: string, online: boolean): Promise<void> {
    const entry = this.clients.get(accountId);
    if (!entry?.isConnected) {
      return;
    }

    try {
      await entry.client.invoke(
        new Api.account.UpdateStatus({
          offline: !online,
        })
      );
      logger.debug(`Set online status for ${entry.account.phone}: ${online ? 'online' : 'offline'}`);
    } catch (error) {
      logger.error(`Failed to set online status for ${entry.account.phone}`, error);
    }
  }

  /**
   * Set online status for all connected accounts
   */
  async setAllOnlineStatus(online: boolean): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [accountId, entry] of this.clients) {
      if (entry.isConnected) {
        promises.push(this.setOnlineStatus(accountId, online));
      }
    }
    await Promise.allSettled(promises);
  }

  /**
   * Start the online status heartbeat to keep all connected accounts online
   */
  startOnlineHeartbeat(): void {
    if (this.onlineHeartbeatInterval) {
      return; // Already running
    }

    logger.info('Starting online status heartbeat');

    // Set all accounts online immediately
    this.setAllOnlineStatus(true);

    // Then send heartbeat periodically
    this.onlineHeartbeatInterval = setInterval(() => {
      this.setAllOnlineStatus(true);
    }, this.ONLINE_HEARTBEAT_MS);
  }

  /**
   * Stop the online status heartbeat
   */
  stopOnlineHeartbeat(): void {
    if (this.onlineHeartbeatInterval) {
      clearInterval(this.onlineHeartbeatInterval);
      this.onlineHeartbeatInterval = null;
      logger.info('Stopped online status heartbeat');
    }
  }
}
