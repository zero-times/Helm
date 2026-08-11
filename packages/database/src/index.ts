export {
  createDatabase,
  type Database,
  type DatabaseConnection,
  type DatabaseOptions,
} from './client';
export {
  defaultMigrationsFolder,
  migrateDatabase,
} from './migrations';
export { assertDatabaseReady } from './readiness';
export * as schema from './schema';

// Re-export drizzle-orm operators so consumers don't need a direct dependency
export { and, count, eq, inArray, sql } from 'drizzle-orm';
