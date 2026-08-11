import type { ServerConfig } from '@helm/config';
import type { FastifyServerOptions } from 'fastify';

type LoggerOptions = Exclude<FastifyServerOptions['logger'], boolean>;

const redactedPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers.set-cookie',
  '*.password',
  '*.token',
  '*.secret',
];

export function createLoggerOptions(
  config: Pick<ServerConfig, 'LOG_LEVEL' | 'NODE_ENV'>,
): LoggerOptions {
  const base = {
    level: config.LOG_LEVEL,
    redact: {
      paths: redactedPaths,
      censor: '[REDACTED]',
    },
  } satisfies LoggerOptions;

  if (config.NODE_ENV !== 'development') {
    return base;
  }

  return {
    ...base,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: 'SYS:standard',
      },
    },
  };
}
