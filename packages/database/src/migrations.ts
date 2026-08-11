import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';

import type { Database } from './client';

export const defaultMigrationsFolder = fileURLToPath(
  new URL('../drizzle', import.meta.url),
);

export async function migrateDatabase(
  database: Database,
  migrationsFolder = defaultMigrationsFolder,
): Promise<void> {
  await migrate(database, { migrationsFolder });
}
