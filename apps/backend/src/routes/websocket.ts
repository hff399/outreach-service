import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { wsHub } from '../index.js';
import { createLogger } from '../lib/logger.js';
import type { WsClientMessage } from '@outreach/shared/types/websocket.js';

const logger = createLogger('WebSocket');

export async function wsRoutes(fastify: FastifyInstance) {
  fastify.get('/', { websocket: true }, (socket: WebSocket, _request: FastifyRequest) => {
    const clientId = wsHub.addClient(socket);

    logger.info(`WebSocket client connected: ${clientId}`);

    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as WsClientMessage;
        wsHub.handleMessage(clientId, message);
      } catch (error) {
        logger.error(`Invalid WebSocket message from ${clientId}`, error);
      }
    });

    socket.on('close', () => {
      wsHub.removeClient(clientId);
      logger.info(`WebSocket client disconnected: ${clientId}`);
    });

    socket.on('error', (error) => {
      logger.error(`WebSocket error for ${clientId}`, error);
      wsHub.removeClient(clientId);
    });
  });
}
