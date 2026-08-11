import cors from '@fastify/cors';
import type { ServerConfig } from '@helm/config';
import Fastify, {
  type FastifyError,
  type FastifyServerOptions,
} from 'fastify';

import { healthRoutes } from './routes/health';

export interface BuildAppOptions {
  config: Pick<ServerConfig, 'APP_VERSION' | 'WEB_ORIGIN'>;
  checkDatabase: () => Promise<void>;
  logger?: FastifyServerOptions['logger'];
}

export function buildApp(options: BuildAppOptions) {
  const server = Fastify({
    logger: options.logger ?? false,
    requestIdHeader: 'x-request-id',
  });

  void server.register(cors, {
    origin: options.config.WEB_ORIGIN,
    credentials: true,
  });

  void server.register(healthRoutes, {
    version: options.config.APP_VERSION,
    checkDatabase: options.checkDatabase,
  });

  server.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'Request failed');
    void reply.code(error.statusCode ?? 500).send({
      error: error.name,
      message:
        error.statusCode !== undefined && error.statusCode < 500
          ? error.message
          : 'Internal server error',
      requestId: request.id,
    });
  });

  return server;
}
