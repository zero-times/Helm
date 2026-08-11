import 'dotenv/config';

import { loadServerConfig } from '@helm/config';

import { createDatabase } from './client';
import { migrateDatabase } from './migrations';

const config = loadServerConfig();
const connection = createDatabase(config.DATABASE_URL, {
  maxConnections: 1,
  // Reapplying a migration journal can emit benign "already exists" notices.
  // The final JSON event is the machine-readable migration result.
  onNotice: () => undefined,
});

try {
  await migrateDatabase(connection.database);
  process.stdout.write(
    `${JSON.stringify({ event: 'database.migrated', status: 'ok' })}\n`,
  );
} finally {
  await connection.close();
}
