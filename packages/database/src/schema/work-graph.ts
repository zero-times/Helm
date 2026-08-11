import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { requirements } from './requirement';

export const workItemStatusEnum = pgEnum('work_item_status', [
  'pending',
  'ready',
  'in_progress',
  'completed',
  'failed',
  'canceled',
]);

export const workGraphs = pgTable('work_graphs', {
  id: uuid('id').defaultRandom().primaryKey(),
  requirementId: uuid('requirement_id')
    .notNull()
    .references(() => requirements.id, { onDelete: 'cascade' })
    .unique(),
  graphVersion: integer('graph_version').default(1).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const graphNodes = pgTable(
  'graph_nodes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    graphId: uuid('graph_id')
      .notNull()
      .references(() => workGraphs.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    title: text('title').notNull(),
    isRequired: boolean('is_required').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('graph_node_graph_key_unique').on(table.graphId, table.key)],
);

export const workEdges = pgTable(
  'work_edges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    graphId: uuid('graph_id')
      .notNull()
      .references(() => workGraphs.id, { onDelete: 'cascade' }),
    sourceNodeId: uuid('source_node_id')
      .notNull()
      .references(() => graphNodes.id, { onDelete: 'cascade' }),
    targetNodeId: uuid('target_node_id')
      .notNull()
      .references(() => graphNodes.id, { onDelete: 'cascade' }),
    isHardDependency: boolean('is_hard_dependency').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('work_edge_unique').on(
      table.graphId,
      table.sourceNodeId,
      table.targetNodeId,
    ),
  ],
);

export const workItems = pgTable('work_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  graphNodeId: uuid('graph_node_id')
    .notNull()
    .references(() => graphNodes.id, { onDelete: 'cascade' })
    .unique(),
  status: workItemStatusEnum('status').default('pending').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
