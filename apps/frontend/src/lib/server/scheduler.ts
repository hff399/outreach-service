import { createLogger } from './logger';
import { processScheduledSteps } from './sequence-trigger';

const logger = createLogger('Scheduler');

let schedulerInterval: NodeJS.Timeout | null = null;

export function startScheduler(intervalMs = 30000): void {
  if (schedulerInterval) {
    logger.warn('Scheduler already running');
    return;
  }

  logger.info(`Starting scheduler with ${intervalMs}ms interval`);

  // Run immediately
  runScheduledTasks();

  // Then run on interval
  schedulerInterval = setInterval(runScheduledTasks, intervalMs);
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info('Scheduler stopped');
  }
}

async function runScheduledTasks(): Promise<void> {
  try {
    await processScheduledSteps();
  } catch (error) {
    logger.error('Scheduler error', error);
  }
}

// Auto-start scheduler on import (server-side only)
if (typeof window === 'undefined') {
  // Use a small delay to ensure everything is initialized
  setTimeout(() => {
    startScheduler(30000); // Run every 30 seconds
  }, 5000);
}
