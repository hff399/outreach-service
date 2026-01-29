import type { WebSocket } from 'ws';
import { createLogger } from '../lib/logger.js';
import type { WsMessage, WsEventType, WsClientMessage } from '@outreach/shared/types/websocket.js';

const logger = createLogger('WebSocketHub');

type ClientInfo = {
  socket: WebSocket;
  id: string;
  channels: Set<string>;
  lastPing: number;
};

export class WebSocketHub {
  private clients: Map<string, ClientInfo> = new Map();
  private channelSubscribers: Map<string, Set<string>> = new Map();
  private pingInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start ping interval
    this.pingInterval = setInterval(() => this.pingClients(), 30000);
  }

  addClient(socket: WebSocket): string {
    const clientId = crypto.randomUUID();

    const clientInfo: ClientInfo = {
      socket,
      id: clientId,
      channels: new Set(),
      lastPing: Date.now(),
    };

    this.clients.set(clientId, clientInfo);

    // Send connection established
    this.sendToClient(clientId, {
      type: 'connection:established',
      payload: {
        client_id: clientId,
        server_time: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    });

    logger.debug(`Client connected: ${clientId}`);
    return clientId;
  }

  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      // Unsubscribe from all channels
      for (const channel of client.channels) {
        this.unsubscribe(clientId, channel);
      }
      this.clients.delete(clientId);
      logger.debug(`Client disconnected: ${clientId}`);
    }
  }

  handleMessage(clientId: string, message: WsClientMessage): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (message.type) {
      case 'subscribe':
        for (const channel of message.channels) {
          this.subscribe(clientId, channel);
        }
        break;

      case 'unsubscribe':
        for (const channel of message.channels) {
          this.unsubscribe(clientId, channel);
        }
        break;

      case 'ping':
        client.lastPing = Date.now();
        this.sendToClient(clientId, {
          type: 'connection:established',
          payload: { pong: true },
          timestamp: new Date().toISOString(),
        });
        break;

      default:
        logger.debug(`Unknown message type from client ${clientId}`, message);
    }
  }

  private subscribe(clientId: string, channel: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.channels.add(channel);

    if (!this.channelSubscribers.has(channel)) {
      this.channelSubscribers.set(channel, new Set());
    }
    this.channelSubscribers.get(channel)!.add(clientId);

    logger.debug(`Client ${clientId} subscribed to ${channel}`);
  }

  private unsubscribe(clientId: string, channel: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.channels.delete(channel);
    }

    const subscribers = this.channelSubscribers.get(channel);
    if (subscribers) {
      subscribers.delete(clientId);
      if (subscribers.size === 0) {
        this.channelSubscribers.delete(channel);
      }
    }
  }

  broadcast<T>(type: WsEventType, payload: T): void {
    const message: WsMessage<T> = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };

    for (const [clientId] of this.clients) {
      this.sendToClient(clientId, message);
    }
  }

  broadcastToChannel<T>(channel: string, type: WsEventType, payload: T): void {
    const subscribers = this.channelSubscribers.get(channel);
    if (!subscribers) return;

    const message: WsMessage<T> = {
      type,
      payload,
      timestamp: new Date().toISOString(),
    };

    for (const clientId of subscribers) {
      this.sendToClient(clientId, message);
    }
  }

  sendToClient<T>(clientId: string, message: WsMessage<T>): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    try {
      client.socket.send(JSON.stringify(message));
    } catch (error) {
      logger.error(`Failed to send to client ${clientId}`, error);
      this.removeClient(clientId);
    }
  }

  // Channel helpers
  getLeadChannel(leadId: string): string {
    return `lead:${leadId}`;
  }

  getAccountChannel(accountId: string): string {
    return `account:${accountId}`;
  }

  getCampaignChannel(campaignId: string): string {
    return `campaign:${campaignId}`;
  }

  // Emit helpers
  emitNewMessage(leadId: string, message: unknown, lead: unknown): void {
    this.broadcastToChannel(this.getLeadChannel(leadId), 'message:new', {
      message,
      lead,
    });
  }

  emitMessageSent(leadId: string, messageId: string): void {
    this.broadcastToChannel(this.getLeadChannel(leadId), 'message:sent', {
      message_id: messageId,
      status: 'sent',
      timestamp: new Date().toISOString(),
    });
  }

  emitAccountStatus(accountId: string, status: string, isConnected: boolean): void {
    this.broadcastToChannel(this.getAccountChannel(accountId), 'account:status_changed', {
      account_id: accountId,
      status,
      is_connected: isConnected,
    });

    // Also broadcast globally
    this.broadcast('account:status_changed', {
      account_id: accountId,
      status,
      is_connected: isConnected,
    });
  }

  emitLeadTyping(leadId: string, isTyping: boolean): void {
    this.broadcastToChannel(this.getLeadChannel(leadId), 'lead:typing', {
      lead_id: leadId,
      is_typing: isTyping,
    });
  }

  emitCampaignProgress(campaignId: string, progress: unknown): void {
    this.broadcastToChannel(this.getCampaignChannel(campaignId), 'campaign:message_sent', progress);
    // Also broadcast globally for dashboard
    this.broadcast('campaign:progress', { campaign_id: campaignId, ...progress as object });
  }

  emitCampaignStatus(campaignId: string, status: string, message?: string): void {
    const payload = {
      campaign_id: campaignId,
      status,
      message,
      timestamp: new Date().toISOString(),
    };
    this.broadcastToChannel(this.getCampaignChannel(campaignId), 'campaign:status', payload);
    this.broadcast('campaign:status', payload);
  }

  private pingClients(): void {
    const now = Date.now();
    const timeout = 60000; // 1 minute

    for (const [clientId, client] of this.clients) {
      if (now - client.lastPing > timeout) {
        logger.debug(`Client ${clientId} timed out`);
        this.removeClient(clientId);
      }
    }
  }

  getClientCount(): number {
    return this.clients.size;
  }

  destroy(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    this.clients.clear();
    this.channelSubscribers.clear();
  }
}

// Singleton instance
export const wsHub = new WebSocketHub();
