import 'dotenv/config';

import { loadServerConfig } from '@helm/config';
import { assertDatabaseReady, createDatabase } from '@helm/database';

import { buildApp } from './app';
import { createLoggerOptions } from './logger';

const config = loadServerConfig();
const connection = createDatabase(config.DATABASE_URL);
const server = buildApp({
  config,
  logger: createLoggerOptions(config),
  checkDatabase: () => assertDatabaseReady(connection.database),
});

let stopping = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;

  server.log.info({ signal }, 'Shutting down');
  await server.close();
  await connection.close();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).then(() => process.exit(0));
  });
}

try {
  await server.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  server.log.fatal({ err: error }, 'Server failed to start');
  await connection.close();
  process.exitCode = 1;
}
