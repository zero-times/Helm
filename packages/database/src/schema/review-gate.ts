import { sql } from 'drizzle-orm';
import {
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

import { members } from './member';
import { executionResults, manualExecutions } from './execution-result';
import { workItems } from './work-graph';

export const reviewStatusEnum = pgEnum('helm_review_status', [
  'pending',
  'approved',
  'rejected',
]);

export const humanGateStatusEnum = pgEnum('helm_human_gate_status', [
  'pending',
  'passed',
  'rework_required',
]);

export const reworkStatusEnum = pgEnum('helm_rework_status', [
  'requested',
  'started',
]);

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey(),
    resultId: uuid('result_id')
      .notNull()
      .references(() => executionResults.id, { onDelete: 'restrict' }),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => manualExecutions.id, { onDelete: 'restrict' }),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'restrict' }),
    graphVersion: integer('graph_version').notNull(),
    reviewerMemberId: uuid('reviewer_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    status: reviewStatusEnum('status').default('pending').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionComment: text('decision_comment'),
    version: integer('version').default(1).notNull(),
  },
  (table) => [
    unique('reviews_result_id_unique').on(table.resultId),
    index('reviews_work_item_requested_idx').on(
      table.workItemId,
      table.requestedAt,
      table.id,
    ),
    check('reviews_graph_version_positive', sql`${table.graphVersion} > 0`),
    check('reviews_version_positive', sql`${table.version} > 0`),
    check(
      'reviews_decision_check',
      sql`(
        (${table.status} = 'pending' AND ${table.decidedAt} IS NULL AND ${table.decisionComment} IS NULL)
        OR (${table.status} = 'approved' AND ${table.decidedAt} IS NOT NULL)
        OR (${table.status} = 'rejected' AND ${table.decidedAt} IS NOT NULL AND length(btrim(${table.decisionComment})) > 0)
      )`,
    ),
    check(
      'reviews_time_check',
      sql`${table.decidedAt} IS NULL OR ${table.decidedAt} >= ${table.requestedAt}`,
    ),
  ],
);

export const humanGates = pgTable(
  'human_gates',
  {
    id: uuid('id').primaryKey(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'restrict' }),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'restrict' }),
    graphVersion: integer('graph_version').notNull(),
    status: humanGateStatusEnum('status').default('pending').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    version: integer('version').default(1).notNull(),
  },
  (table) => [
    unique('human_gates_review_id_unique').on(table.reviewId),
    index('human_gates_work_item_opened_idx').on(
      table.workItemId,
      table.openedAt,
      table.id,
    ),
    check('human_gates_graph_version_positive', sql`${table.graphVersion} > 0`),
    check('human_gates_version_positive', sql`${table.version} > 0`),
    check(
      'human_gates_resolution_check',
      sql`(
        (${table.status} = 'pending' AND ${table.resolvedAt} IS NULL)
        OR (${table.status} IN ('passed', 'rework_required') AND ${table.resolvedAt} IS NOT NULL)
      )`,
    ),
    check(
      'human_gates_time_check',
      sql`${table.resolvedAt} IS NULL OR ${table.resolvedAt} >= ${table.openedAt}`,
    ),
  ],
);

export const reworkRequests = pgTable(
  'rework_requests',
  {
    id: uuid('id').primaryKey(),
    rejectedReviewId: uuid('rejected_review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'restrict' }),
    previousExecutionId: uuid('previous_execution_id')
      .notNull()
      .references(() => manualExecutions.id, { onDelete: 'restrict' }),
    previousResultId: uuid('previous_result_id')
      .notNull()
      .references(() => executionResults.id, { onDelete: 'restrict' }),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'restrict' }),
    graphVersion: integer('graph_version').notNull(),
    reason: text('reason').notNull(),
    status: reworkStatusEnum('status').default('requested').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    newExecutionId: uuid('new_execution_id').references(() => manualExecutions.id, {
      onDelete: 'restrict',
    }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    version: integer('version').default(1).notNull(),
  },
  (table) => [
    unique('rework_requests_rejected_review_unique').on(table.rejectedReviewId),
    unique('rework_requests_new_execution_unique').on(table.newExecutionId),
    index('rework_requests_work_item_requested_idx').on(
      table.workItemId,
      table.requestedAt,
      table.id,
    ),
    check('rework_requests_graph_version_positive', sql`${table.graphVersion} > 0`),
    check('rework_requests_version_positive', sql`${table.version} > 0`),
    check('rework_requests_reason_non_blank', sql`length(btrim(${table.reason})) > 0`),
    check(
      'rework_requests_start_check',
      sql`(
        (${table.status} = 'requested' AND ${table.newExecutionId} IS NULL AND ${table.startedAt} IS NULL)
        OR (${table.status} = 'started' AND ${table.newExecutionId} IS NOT NULL AND ${table.startedAt} IS NOT NULL)
      )`,
    ),
    check(
      'rework_requests_time_check',
      sql`${table.startedAt} IS NULL OR ${table.startedAt} >= ${table.requestedAt}`,
    ),
  ],
);
