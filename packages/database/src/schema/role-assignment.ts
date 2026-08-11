import {
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { members } from './member';
import { organizations } from './organization';

export const roleTypeEnum = pgEnum('role_type', [
  'owner',
  'admin',
  'member',
  'viewer',
]);

export const roleAssignments = pgTable(
  'role_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    role: roleTypeEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    memberOrgRoleUnique: uniqueIndex('ra_member_org_role_unique').on(
      table.memberId,
      table.organizationId,
      table.role,
    ),
  }),
);
