import { appConfig } from './config.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_COLORS = {
  debug: '\x1b[36m', // cyan
  info: '\x1b[32m',  // green
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
  reset: '\x1b[0m',
};

function formatMessage(level: LogLevel, context: string, message: string, meta?: unknown): string {
  const timestamp = new Date().toISOString();
  const color = LOG_COLORS[level];
  const reset = LOG_COLORS.reset;

  let output = `${color}[${timestamp}] [${level.toUpperCase()}] [${context}]${reset} ${message}`;

  if (meta !== undefined) {
    output += ` ${JSON.stringify(meta, null, appConfig.isDev ? 2 : 0)}`;
  }

  return output;
}

export function createLogger(context: string) {
  return {
    debug(message: string, meta?: unknown) {
      if (appConfig.isDev) {
        console.debug(formatMessage('debug', context, message, meta));
      }
    },
    info(message: string, meta?: unknown) {
      console.info(formatMessage('info', context, message, meta));
    },
    warn(message: string, meta?: unknown) {
      console.warn(formatMessage('warn', context, message, meta));
    },
    error(message: string, meta?: unknown) {
      console.error(formatMessage('error', context, message, meta));
    },
  };
}

export const logger = createLogger('app');
