import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { executionResults, manualExecutions } from './execution-result';
import { members } from './member';
import { requirements } from './requirement';
import { humanGates, reviews } from './review-gate';

export const bugDiscoveryStageEnum = pgEnum('helm_bug_discovery_stage', [
  'requirement',
  'design',
  'implementation',
  'review',
  'qa',
  'release',
  'production',
]);

export const bugSeverityEnum = pgEnum('helm_bug_severity', [
  'low',
  'medium',
  'high',
  'critical',
]);

export const bugStatusEnum = pgEnum('helm_bug_status', [
  'open',
  'fix_in_progress',
  'awaiting_qa',
  'closed',
]);

export const qaRegressionStatusEnum = pgEnum('helm_qa_regression_status', [
  'pending',
  'passed',
  'failed',
]);

export const bugWorkItems = pgTable(
  'bug_work_items',
  {
    id: uuid('id').primaryKey(),
    sourceRequirementId: uuid('source_requirement_id')
      .notNull()
      .references(() => requirements.id, { onDelete: 'restrict' }),
    graphVersion: integer('graph_version').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    discoveredIn: bugDiscoveryStageEnum('discovered_in').notNull(),
    severity: bugSeverityEnum('severity').notNull(),
    blocking: boolean('blocking').notNull(),
    reporterMemberId: uuid('reporter_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    status: bugStatusEnum('status').default('open').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    version: integer('version').default(1).notNull(),
  },
  (table) => [
    index('bug_work_items_requirement_idx').on(
      table.sourceRequirementId,
      table.status,
      table.blocking,
    ),
    check('bug_work_items_graph_version_positive', sql`${table.graphVersion} > 0`),
    check('bug_work_items_title_non_blank', sql`length(btrim(${table.title})) > 0`),
    check(
      'bug_work_items_description_non_blank',
      sql`length(btrim(${table.description})) > 0`,
    ),
    check('bug_work_items_version_positive', sql`${table.version} > 0`),
    check(
      'bug_work_items_close_check',
      sql`(
        (${table.status} = 'closed' AND ${table.blocking} = false AND ${table.closedAt} IS NOT NULL)
        OR (${table.status} <> 'closed' AND ${table.closedAt} IS NULL)
      )`,
    ),
  ],
);

export const bugFixEdges = pgTable(
  'bug_fix_edges',
  {
    id: uuid('id').primaryKey(),
    bugId: uuid('bug_id')
      .notNull()
      .references(() => bugWorkItems.id, { onDelete: 'restrict' }),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => manualExecutions.id, { onDelete: 'restrict' }),
    resultId: uuid('result_id')
      .notNull()
      .references(() => executionResults.id, { onDelete: 'restrict' }),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'restrict' }),
    passedGateId: uuid('passed_gate_id')
      .notNull()
      .references(() => humanGates.id, { onDelete: 'restrict' }),
    fixedAt: timestamp('fixed_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    unique('bug_fix_edges_execution_unique').on(table.executionId),
    unique('bug_fix_edges_result_unique').on(table.resultId),
    unique('bug_fix_edges_review_unique').on(table.reviewId),
    unique('bug_fix_edges_gate_unique').on(table.passedGateId),
  ],
);

export const qaRegressionEdges = pgTable(
  'qa_regression_edges',
  {
    id: uuid('id').primaryKey(),
    bugId: uuid('bug_id')
      .notNull()
      .references(() => bugWorkItems.id, { onDelete: 'restrict' }),
    fixEdgeId: uuid('fix_edge_id')
      .notNull()
      .references(() => bugFixEdges.id, { onDelete: 'restrict' }),
    qaMemberId: uuid('qa_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    status: qaRegressionStatusEnum('status').default('pending').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    notes: text('notes'),
    version: integer('version').default(1).notNull(),
  },
  (table) => [
    unique('qa_regression_edges_fix_unique').on(table.fixEdgeId),
    index('qa_regression_edges_bug_idx').on(table.bugId, table.requestedAt),
    check('qa_regression_edges_version_positive', sql`${table.version} > 0`),
    check(
      'qa_regression_edges_completion_check',
      sql`(
        (${table.status} = 'pending' AND ${table.completedAt} IS NULL)
        OR (${table.status} IN ('passed', 'failed') AND ${table.completedAt} IS NOT NULL)
      )`,
    ),
  ],
);
