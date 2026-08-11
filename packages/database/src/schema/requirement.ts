import { sql } from 'drizzle-orm';
import {
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { members } from './member';
import { projects } from './project';

export const requirementStatusEnum = pgEnum('requirement_status', [
  'planned',
  'in_progress',
  'blocked',
  'completed',
  'canceled',
]);

export const requirements = pgTable('requirements', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  goal: text('goal').notNull(),
  acceptanceCriteria: jsonb('acceptance_criteria')
    .notNull()
    .default(sql`'[]'::jsonb`),
  accountableHumanId: uuid('accountable_human_id')
    .notNull()
    .references(() => members.id, { onDelete: 'restrict' }),
  operationalOwnerId: uuid('operational_owner_id')
    .notNull()
    .references(() => members.id, { onDelete: 'restrict' }),
  assigneeMemberId: uuid('assignee_member_id')
    .notNull()
    .references(() => members.id, { onDelete: 'restrict' }),
  status: requirementStatusEnum('status').default('planned').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
