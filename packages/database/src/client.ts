import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

export interface DatabaseOptions {
  maxConnections?: number;
  onNotice?: (notice: unknown) => void;
}

export function createDatabase(
  url: string,
  options: DatabaseOptions = {},
) {
  const client = postgres(url, {
    max: options.maxConnections ?? 10,
    prepare: false,
    ...(options.onNotice ? { onnotice: options.onNotice } : {}),
  });
  const database = drizzle(client, { schema });

  return {
    database,
    client,
    async close(): Promise<void> {
      await client.end({ timeout: 5 });
    },
  };
}

export type DatabaseConnection = ReturnType<typeof createDatabase>;
export type Database = DatabaseConnection['database'];
