import { sql } from 'drizzle-orm';

import type { Database } from './client';

export async function assertDatabaseReady(database: Database): Promise<void> {
  await database.execute(sql`select 1`);
}
