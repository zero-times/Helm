import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { members } from './member';
import { organizations } from './organization';

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    accountableHumanId: uuid('accountable_human_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    operationalOwnerId: uuid('operational_owner_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    orgSlugUnique: uniqueIndex('project_org_slug_unique').on(
      table.organizationId,
      table.slug,
    ),
  }),
);
