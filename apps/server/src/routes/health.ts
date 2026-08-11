import type { HealthResponse } from '@helm/contracts';
import type { FastifyPluginCallback } from 'fastify';

export interface HealthRoutesOptions {
  version: string;
  checkDatabase: () => Promise<void>;
}

function baseHealth(version: string) {
  return {
    service: 'helm-server' as const,
    version,
    timestamp: new Date().toISOString(),
  };
}

export const healthRoutes: FastifyPluginCallback<HealthRoutesOptions> = (
  server,
  options,
  done,
) => {
  server.get('/health/live', (): HealthResponse => ({
    ...baseHealth(options.version),
    status: 'ok',
  }));

  server.get('/health/ready', async (_request, reply) => {
    try {
      await options.checkDatabase();

      return {
        ...baseHealth(options.version),
        status: 'ok' as const,
        checks: { database: 'ok' as const },
      } satisfies HealthResponse;
    } catch (error) {
      server.log.warn({ err: error }, 'Database readiness check failed');

      return reply.code(503).send({
        ...baseHealth(options.version),
        status: 'error',
        checks: { database: 'error' },
      } satisfies HealthResponse);
    }
  });

  done();
};
