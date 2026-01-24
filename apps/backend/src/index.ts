import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import { appConfig } from './lib/config.js';
import { logger } from './lib/logger.js';
import { TgAccountManager } from './services/tg-account-manager.js';
import { wsHub } from './services/websocket-hub.js';
import { JobScheduler } from './jobs/scheduler.js';
import { startSequenceScheduler, stopSequenceScheduler } from './services/sequence-scheduler.js';

// Routes
import { accountsRoutes } from './routes/accounts.js';
import { campaignsRoutes } from './routes/campaigns.js';
import { sequencesRoutes } from './routes/sequences.js';
import { leadsRoutes } from './routes/leads.js';
import { messagesRoutes } from './routes/messages.js';
import { groupsRoutes } from './routes/groups.js';
import { templatesRoutes } from './routes/templates.js';
import { statusesRoutes } from './routes/statuses.js';
import { wsRoutes } from './routes/websocket.js';
import { uploadsRoutes } from './routes/uploads.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fastify = Fastify({
  logger: appConfig.isDev,
});

// Global instances
export const tgManager = new TgAccountManager();
export { wsHub };
export const jobScheduler = new JobScheduler(tgManager, wsHub);

async function start() {
  try {
    // Register plugins
    await fastify.register(cors, {
      origin: appConfig.server.corsOrigin,
      credentials: true,
    });

    await fastify.register(websocket, {
      options: { maxPayload: 1048576 },
    });

    await fastify.register(multipart, {
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB
      },
    });

    // Static file serving for uploads
    await fastify.register(fastifyStatic, {
      root: join(__dirname, '../uploads'),
      prefix: '/uploads/',
      decorateReply: true,
    });

    // Health check
    fastify.get('/health', async () => {
      const accountsHealth = await tgManager.getHealthStatus();
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        accounts: accountsHealth,
      };
    });

    // Register routes
    await fastify.register(accountsRoutes, { prefix: '/api/accounts' });
    await fastify.register(campaignsRoutes, { prefix: '/api/campaigns' });
    await fastify.register(sequencesRoutes, { prefix: '/api/sequences' });
    await fastify.register(leadsRoutes, { prefix: '/api/leads' });
    await fastify.register(messagesRoutes, { prefix: '/api/messages' });
    await fastify.register(groupsRoutes, { prefix: '/api/groups' });
    await fastify.register(templatesRoutes, { prefix: '/api/templates' });
    await fastify.register(statusesRoutes, { prefix: '/api/statuses' });
    await fastify.register(uploadsRoutes, { prefix: '/api/uploads' });
    await fastify.register(wsRoutes, { prefix: '/ws' });

    // Initialize TG accounts
    logger.info('Initializing Telegram accounts...');
    await tgManager.initializeAllAccounts();

    // Start job scheduler
    logger.info('Starting job scheduler...');
    jobScheduler.start();

    // Start sequence scheduler (for time-based triggers)
    logger.info('Starting sequence scheduler...');
    startSequenceScheduler(30000); // Check every 30 seconds

    // Start server
    await fastify.listen({
      port: appConfig.server.port,
      host: appConfig.server.host,
    });

    logger.info(`Server started on ${appConfig.server.host}:${appConfig.server.port}`);
  } catch (err) {
    logger.error('Failed to start server', err);
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  logger.info('Shutting down...');

  jobScheduler.stop();
  stopSequenceScheduler();
  await tgManager.disconnectAll();
  await fastify.close();

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
