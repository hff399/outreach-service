import type { WsMessage, WsClientMessage, WsEventType } from '@shared/types/websocket';

type MessageHandler = (payload: unknown) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: Map<WsEventType, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: NodeJS.Timeout | null = null;
  private clientId: string | null = null;

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';

      this.ws = new WebSocket(`${wsUrl}/ws`);

      this.ws.onopen = () => {
        console.log('[WS] Connected');
        this.reconnectAttempts = 0;
        this.startPing();
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WsMessage;
          this.handleMessage(message);
        } catch (error) {
          console.error('[WS] Failed to parse message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('[WS] Disconnected');
        this.stopPing();
        this.attemptReconnect();
      };

      this.ws.onerror = (error) => {
        console.error('[WS] Error:', error);
        reject(error);
      };
    });
  }

  private handleMessage(message: WsMessage): void {
    if (message.type === 'connection:established') {
      const payload = message.payload as { client_id?: string };
      this.clientId = payload.client_id || null;
    }

    const handlers = this.handlers.get(message.type);
    if (handlers) {
      handlers.forEach((handler) => handler(message.payload));
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(console.error);
    }, delay);
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      this.send({ type: 'ping' });
    }, 30000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  send(message: WsClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  subscribe(channels: string[]): void {
    this.send({ type: 'subscribe', channels });
  }

  unsubscribe(channels: string[]): void {
    this.send({ type: 'unsubscribe', channels });
  }

  on(event: WsEventType, handler: MessageHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  off(event: WsEventType, handler: MessageHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  disconnect(): void {
    this.stopPing();
    this.ws?.close();
    this.ws = null;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get id(): string | null {
    return this.clientId;
  }
}

export const wsClient = new WebSocketClient();
