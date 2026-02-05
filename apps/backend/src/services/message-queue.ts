import { EventEmitter } from 'events';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('MessageQueue');
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Queue item types
export type QueueItemType = 'campaign_message' | 'sequence_step' | 'sequence_enrollment';

export interface QueueItem {
  id: string;
  type: QueueItemType;
  payload: Record<string, unknown>;
  priority: number; // Higher = more urgent
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  scheduledFor: number; // Timestamp when to execute
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
  templateVariables?: Record<string, string>;
}

export interface SequenceStepPayload {
  enrollmentId: string;
  stepId: string;
  sequenceId: string;
  leadId: string;
  accountId?: string;
}

export interface SequenceEnrollmentPayload {
  sequenceId: string;
  leadId: string;
  accountId: string;
  messageText: string;
}

type QueueProcessor = (item: QueueItem) => Promise<void>;

const QUEUE_FILE_PATH = join(__dirname, '../../data/queue.json');
const PROCESSED_FILE_PATH = join(__dirname, '../../data/queue-processed.json');

export class MessageQueue extends EventEmitter {
  private queue: Map<string, QueueItem> = new Map();
  private processors: Map<QueueItemType, QueueProcessor> = new Map();
  private isProcessing = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private persistInterval: NodeJS.Timeout | null = null;
  private concurrentLimit = 3;
  private activeProcessing = 0;
  private processedCount = 0;
  private failedCount = 0;

  constructor() {
    super();
    this.loadFromDisk();
  }

  /**
   * Register a processor for a specific queue item type
   */
  registerProcessor(type: QueueItemType, processor: QueueProcessor): void {
    this.processors.set(type, processor);
    logger.info(`Registered processor for type: ${type}`);
  }

  /**
   * Add an item to the queue
   */
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
    const id = this.generateId();
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
    logger.debug(`Enqueued item ${id} of type ${type}`, { scheduledFor: new Date(item.scheduledFor).toISOString() });

    this.emit('enqueue', item);
    return id;
  }

  /**
   * Add multiple items to the queue (batch)
   */
  enqueueBatch(
    type: QueueItemType,
    payloads: Record<string, unknown>[],
    options: {
      priority?: number;
      maxAttempts?: number;
      delayBetweenMs?: number;
      startDelayMs?: number;
    } = {}
  ): string[] {
    const ids: string[] = [];
    const baseDelay = options.startDelayMs ?? 0;
    const delayBetween = options.delayBetweenMs ?? 0;

    payloads.forEach((payload, index) => {
      const delayMs = baseDelay + (index * delayBetween);
      const id = this.enqueue(type, payload, {
        priority: options.priority,
        maxAttempts: options.maxAttempts,
        delayMs,
      });
      ids.push(id);
    });

    logger.info(`Batch enqueued ${ids.length} items of type ${type}`);
    return ids;
  }

  /**
   * Cancel a queued item
   */
  cancel(id: string): boolean {
    const item = this.queue.get(id);
    if (!item) return false;

    if (item.status === 'processing') {
      logger.warn(`Cannot cancel item ${id} - currently processing`);
      return false;
    }

    this.queue.delete(id);
    logger.info(`Cancelled queue item ${id}`);
    return true;
  }

  /**
   * Cancel all items matching criteria
   */
  cancelAll(criteria: { type?: QueueItemType; payloadMatch?: Record<string, unknown> }): number {
    let cancelled = 0;

    for (const [id, item] of this.queue.entries()) {
      if (item.status === 'processing') continue;

      let matches = true;

      if (criteria.type && item.type !== criteria.type) {
        matches = false;
      }

      if (criteria.payloadMatch && matches) {
        for (const [key, value] of Object.entries(criteria.payloadMatch)) {
          if (item.payload[key] !== value) {
            matches = false;
            break;
          }
        }
      }

      if (matches) {
        this.queue.delete(id);
        cancelled++;
      }
    }

    logger.info(`Cancelled ${cancelled} queue items`, criteria);
    return cancelled;
  }

  /**
   * Start processing the queue
   */
  start(intervalMs = 1000): void {
    if (this.processingInterval) {
      logger.warn('Queue processor already running');
      return;
    }

    this.isProcessing = true;
    logger.info('Starting message queue processor');

    // Process queue on interval
    this.processingInterval = setInterval(() => {
      this.processNext();
    }, intervalMs);

    // Persist to disk every 10 seconds
    this.persistInterval = setInterval(() => {
      this.persistToDisk();
    }, 10000);

    // Process immediately
    this.processNext();
  }

  /**
   * Stop processing the queue
   */
  stop(): void {
    this.isProcessing = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    if (this.persistInterval) {
      clearInterval(this.persistInterval);
      this.persistInterval = null;
    }

    // Final persist
    this.persistToDisk();

    logger.info('Message queue processor stopped');
  }

  /**
   * Process next items in the queue
   */
  private async processNext(): Promise<void> {
    if (!this.isProcessing) return;
    if (this.activeProcessing >= this.concurrentLimit) return;

    const now = Date.now();

    // Get items ready to process (scheduled time passed, not processing)
    const readyItems = Array.from(this.queue.values())
      .filter(item =>
        (item.status === 'pending' || item.status === 'scheduled') &&
        item.scheduledFor <= now
      )
      .sort((a, b) => {
        // Sort by priority (desc) then by scheduledFor (asc)
        if (a.priority !== b.priority) return b.priority - a.priority;
        return a.scheduledFor - b.scheduledFor;
      });

    // Process up to concurrent limit
    const toProcess = readyItems.slice(0, this.concurrentLimit - this.activeProcessing);

    for (const item of toProcess) {
      this.processItem(item);
    }
  }

  /**
   * Process a single queue item
   */
  private async processItem(item: QueueItem): Promise<void> {
    const processor = this.processors.get(item.type);
    if (!processor) {
      logger.error(`No processor registered for type: ${item.type}`);
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

      logger.error(`Failed to process queue item ${item.id}`, {
        error: err.message,
        attempt: item.attempts,
        maxAttempts: item.maxAttempts,
      });

      if (item.attempts >= item.maxAttempts) {
        item.status = 'failed';
        this.failedCount++;
        this.queue.delete(item.id);
        this.emit('failed', item);
        logger.error(`Queue item ${item.id} permanently failed after ${item.attempts} attempts`);
      } else {
        // Exponential backoff for retry
        const backoffMs = Math.min(1000 * Math.pow(2, item.attempts), 60000);
        item.scheduledFor = Date.now() + backoffMs;
        item.status = 'scheduled';
        logger.info(`Queue item ${item.id} scheduled for retry in ${backoffMs}ms`);
      }
    } finally {
      this.activeProcessing--;
    }
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    pending: number;
    scheduled: number;
    processing: number;
    total: number;
    processed: number;
    failed: number;
    byType: Record<string, number>;
  } {
    const stats = {
      pending: 0,
      scheduled: 0,
      processing: 0,
      total: this.queue.size,
      processed: this.processedCount,
      failed: this.failedCount,
      byType: {} as Record<string, number>,
    };

    for (const item of this.queue.values()) {
      if (item.status === 'pending') stats.pending++;
      if (item.status === 'scheduled') stats.scheduled++;
      if (item.status === 'processing') stats.processing++;

      stats.byType[item.type] = (stats.byType[item.type] || 0) + 1;
    }

    return stats;
  }

  /**
   * Get items by type
   */
  getItemsByType(type: QueueItemType): QueueItem[] {
    return Array.from(this.queue.values()).filter(item => item.type === type);
  }

  /**
   * Get items by payload match
   */
  getItemsByPayload(criteria: Record<string, unknown>): QueueItem[] {
    return Array.from(this.queue.values()).filter(item => {
      for (const [key, value] of Object.entries(criteria)) {
        if (item.payload[key] !== value) return false;
      }
      return true;
    });
  }

  /**
   * Persist queue to disk for recovery
   */
  private persistToDisk(): void {
    try {
      const dataDir = dirname(QUEUE_FILE_PATH);
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }

      const items = Array.from(this.queue.values())
        .filter(item => item.status !== 'processing'); // Don't persist processing items

      writeFileSync(QUEUE_FILE_PATH, JSON.stringify(items, null, 2));
      logger.debug(`Persisted ${items.length} queue items to disk`);
    } catch (error) {
      logger.error('Failed to persist queue to disk', error);
    }
  }

  /**
   * Load queue from disk on startup
   */
  private loadFromDisk(): void {
    try {
      if (!existsSync(QUEUE_FILE_PATH)) {
        logger.info('No queue file found, starting fresh');
        return;
      }

      const data = readFileSync(QUEUE_FILE_PATH, 'utf-8');
      const items = JSON.parse(data) as QueueItem[];

      let restored = 0;
      for (const item of items) {
        // Reset processing items to pending
        if (item.status === 'processing') {
          item.status = 'pending';
        }
        this.queue.set(item.id, item);
        restored++;
      }

      logger.info(`Restored ${restored} queue items from disk`);
    } catch (error) {
      logger.error('Failed to load queue from disk', error);
    }
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Reschedule an item
   */
  reschedule(id: string, delayMs: number): boolean {
    const item = this.queue.get(id);
    if (!item) return false;

    if (item.status === 'processing') {
      logger.warn(`Cannot reschedule item ${id} - currently processing`);
      return false;
    }

    item.scheduledFor = Date.now() + delayMs;
    item.status = 'scheduled';
    logger.info(`Rescheduled queue item ${id} for ${delayMs}ms from now`);
    return true;
  }

  /**
   * Update item payload
   */
  updatePayload(id: string, payload: Record<string, unknown>): boolean {
    const item = this.queue.get(id);
    if (!item) return false;

    item.payload = { ...item.payload, ...payload };
    return true;
  }

  /**
   * Check if queue has items for a specific criteria
   */
  has(criteria: { type?: QueueItemType; payloadMatch?: Record<string, unknown> }): boolean {
    for (const item of this.queue.values()) {
      let matches = true;

      if (criteria.type && item.type !== criteria.type) {
        matches = false;
      }

      if (criteria.payloadMatch && matches) {
        for (const [key, value] of Object.entries(criteria.payloadMatch)) {
          if (item.payload[key] !== value) {
            matches = false;
            break;
          }
        }
      }

      if (matches) return true;
    }

    return false;
  }

  /**
   * Clear all items (use with caution)
   */
  clear(): void {
    const count = this.queue.size;
    this.queue.clear();
    logger.warn(`Cleared ${count} items from queue`);
  }
}

// Singleton instance
export const messageQueue = new MessageQueue();
