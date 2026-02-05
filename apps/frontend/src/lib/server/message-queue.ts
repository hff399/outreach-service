import { EventEmitter } from 'events';
import { createLogger } from './logger';

const logger = createLogger('MessageQueue');

export type QueueItemType = 'campaign_message' | 'sequence_step';

export interface QueueItem {
  id: string;
  type: QueueItemType;
  payload: Record<string, unknown>;
  priority: number;
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  scheduledFor: number;
  lastAttemptAt?: number;
  lastError?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'scheduled';
}

export interface CampaignMessagePayload {
  campaignId: string;
  groupId: string;
  groupUsername: string;
  groupTitle: string;
  accountId: string;
  messageText: string;
}

export interface SequenceStepPayload {
  enrollmentId: string;
  stepId: string;
  sequenceId: string;
  leadId: string;
  accountId?: string;
}

type QueueProcessor = (item: QueueItem) => Promise<void>;

class MessageQueue extends EventEmitter {
  private queue: Map<string, QueueItem> = new Map();
  private processors: Map<QueueItemType, QueueProcessor> = new Map();
  private isProcessing = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private concurrentLimit = 3;
  private activeProcessing = 0;
  private processedCount = 0;
  private failedCount = 0;

  registerProcessor(type: QueueItemType, processor: QueueProcessor): void {
    this.processors.set(type, processor);
    logger.info(`Registered processor for type: ${type}`);
  }

  enqueue(
    type: QueueItemType,
    payload: Record<string, unknown>,
    options: {
      priority?: number;
      maxAttempts?: number;
      delayMs?: number;
      scheduledFor?: number;
    } = {}
  ): string {
    const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    const item: QueueItem = {
      id,
      type,
      payload,
      priority: options.priority ?? 5,
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 3,
      createdAt: now,
      scheduledFor: options.scheduledFor ?? (now + (options.delayMs ?? 0)),
      status: options.delayMs || options.scheduledFor ? 'scheduled' : 'pending',
    };

    this.queue.set(id, item);
    logger.debug(`Enqueued item ${id} of type ${type}`);
    this.emit('enqueue', item);
    return id;
  }

  enqueueBatch(
    type: QueueItemType,
    payloads: Record<string, unknown>[],
    options: { priority?: number; maxAttempts?: number; delayBetweenMs?: number; startDelayMs?: number } = {}
  ): string[] {
    const ids: string[] = [];
    const baseDelay = options.startDelayMs ?? 0;
    const delayBetween = options.delayBetweenMs ?? 0;

    payloads.forEach((payload, index) => {
      const delayMs = baseDelay + (index * delayBetween);
      const id = this.enqueue(type, payload, { priority: options.priority, maxAttempts: options.maxAttempts, delayMs });
      ids.push(id);
    });

    logger.info(`Batch enqueued ${ids.length} items of type ${type}`);
    return ids;
  }

  cancel(id: string): boolean {
    const item = this.queue.get(id);
    if (!item || item.status === 'processing') return false;
    this.queue.delete(id);
    return true;
  }

  cancelAll(criteria: { type?: QueueItemType; payloadMatch?: Record<string, unknown> }): number {
    let cancelled = 0;
    const entries = Array.from(this.queue.entries());
    for (const [id, item] of entries) {
      if (item.status === 'processing') continue;
      let matches = true;
      if (criteria.type && item.type !== criteria.type) matches = false;
      if (criteria.payloadMatch && matches) {
        const payloadEntries = Object.entries(criteria.payloadMatch);
        for (const [key, value] of payloadEntries) {
          if (item.payload[key] !== value) { matches = false; break; }
        }
      }
      if (matches) { this.queue.delete(id); cancelled++; }
    }
    logger.info(`Cancelled ${cancelled} queue items`);
    return cancelled;
  }

  start(intervalMs = 1000): void {
    if (this.processingInterval) return;
    this.isProcessing = true;
    logger.info('Starting message queue processor');
    this.processingInterval = setInterval(() => this.processNext(), intervalMs);
    this.processNext();
  }

  stop(): void {
    this.isProcessing = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    logger.info('Message queue processor stopped');
  }

  private async processNext(): Promise<void> {
    if (!this.isProcessing || this.activeProcessing >= this.concurrentLimit) return;

    const now = Date.now();
    const readyItems = Array.from(this.queue.values())
      .filter(item => (item.status === 'pending' || item.status === 'scheduled') && item.scheduledFor <= now)
      .sort((a, b) => b.priority !== a.priority ? b.priority - a.priority : a.scheduledFor - b.scheduledFor);

    const toProcess = readyItems.slice(0, this.concurrentLimit - this.activeProcessing);
    for (const item of toProcess) {
      this.processItem(item);
    }
  }

  private async processItem(item: QueueItem): Promise<void> {
    const processor = this.processors.get(item.type);
    if (!processor) {
      item.status = 'failed';
      item.lastError = 'No processor registered';
      return;
    }

    item.status = 'processing';
    item.attempts++;
    item.lastAttemptAt = Date.now();
    this.activeProcessing++;

    try {
      await processor(item);
      item.status = 'completed';
      this.processedCount++;
      this.queue.delete(item.id);
      logger.debug(`Processed queue item ${item.id} successfully`);
      this.emit('processed', item);
    } catch (error) {
      const err = error as Error;
      item.lastError = err.message;
      logger.error(`Failed to process queue item ${item.id}`, { error: err.message, attempt: item.attempts });

      if (item.attempts >= item.maxAttempts) {
        item.status = 'failed';
        this.failedCount++;
        this.queue.delete(item.id);
        this.emit('failed', item);
      } else {
        const backoffMs = Math.min(1000 * Math.pow(2, item.attempts), 60000);
        item.scheduledFor = Date.now() + backoffMs;
        item.status = 'scheduled';
      }
    } finally {
      this.activeProcessing--;
    }
  }

  getStats() {
    const stats = { pending: 0, scheduled: 0, processing: 0, total: this.queue.size, processed: this.processedCount, failed: this.failedCount, byType: {} as Record<string, number> };
    const items = Array.from(this.queue.values());
    for (const item of items) {
      if (item.status === 'pending') stats.pending++;
      if (item.status === 'scheduled') stats.scheduled++;
      if (item.status === 'processing') stats.processing++;
      stats.byType[item.type] = (stats.byType[item.type] || 0) + 1;
    }
    return stats;
  }

  has(criteria: { type?: QueueItemType; payloadMatch?: Record<string, unknown> }): boolean {
    const items = Array.from(this.queue.values());
    for (const item of items) {
      let matches = true;
      if (criteria.type && item.type !== criteria.type) matches = false;
      if (criteria.payloadMatch && matches) {
        const payloadEntries = Object.entries(criteria.payloadMatch);
        for (const [key, value] of payloadEntries) {
          if (item.payload[key] !== value) { matches = false; break; }
        }
      }
      if (matches) return true;
    }
    return false;
  }

  getItemsByPayload(criteria: Record<string, unknown>): QueueItem[] {
    return Array.from(this.queue.values()).filter(item => {
      for (const [key, value] of Object.entries(criteria)) {
        if (item.payload[key] !== value) return false;
      }
      return true;
    });
  }
}

// Singleton instance - persists across API route calls
const globalForQueue = globalThis as unknown as { messageQueue: MessageQueue | undefined };
export const messageQueue = globalForQueue.messageQueue ?? new MessageQueue();
if (process.env.NODE_ENV !== 'production') globalForQueue.messageQueue = messageQueue;
