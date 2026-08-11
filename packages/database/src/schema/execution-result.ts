import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { members } from './member';
import { workItems } from './work-graph';

export const manualExecutionModeEnum = pgEnum('helm_manual_execution_mode', [
  'self',
  'external_manual',
]);

export const manualExecutionStatusEnum = pgEnum('helm_manual_execution_status', [
  'running',
  'waiting_for_input',
  'completed',
  'failed',
  'cancelled',
]);

export const verificationSourceEnum = pgEnum('helm_verification_source', [
  'unverified',
  'agent_reported',
  'runner_verified',
  'ci_verified',
  'human_verified',
]);

export const artifactKindEnum = pgEnum('helm_artifact_kind', [
  'file',
  'url',
  'commit',
  'patch',
  'log',
  'report',
  'other',
]);

export const executionTestStatusEnum = pgEnum('helm_test_status', [
  'passed',
  'failed',
  'skipped',
  'not_run',
]);

export const issueSeverityEnum = pgEnum('helm_issue_severity', [
  'low',
  'medium',
  'high',
  'critical',
]);

export const manualExecutions = pgTable(
  'manual_executions',
  {
    id: uuid('id').primaryKey(),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'restrict' }),
    graphVersion: integer('graph_version').notNull(),
    mode: manualExecutionModeEnum('mode').notNull(),
    executorMemberId: uuid('executor_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    status: manualExecutionStatusEnum('status').default('running').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    waitingReason: text('waiting_reason'),
    endReason: text('end_reason'),
    version: integer('version').default(1).notNull(),
  },
  (table) => [
    index('manual_executions_work_item_started_idx').on(
      table.workItemId,
      table.startedAt,
      table.id,
    ),
    check('manual_executions_graph_version_positive', sql`${table.graphVersion} > 0`),
    check('manual_executions_version_positive', sql`${table.version} > 0`),
    check(
      'manual_executions_lifecycle_check',
      sql`(
        (${table.status} = 'running' AND ${table.endedAt} IS NULL AND ${table.waitingReason} IS NULL)
        OR (${table.status} = 'waiting_for_input' AND ${table.endedAt} IS NULL AND ${table.waitingReason} IS NOT NULL)
        OR (${table.status} = 'completed' AND ${table.endedAt} IS NOT NULL AND ${table.waitingReason} IS NULL)
        OR (${table.status} IN ('failed', 'cancelled') AND ${table.endedAt} IS NOT NULL AND ${table.waitingReason} IS NULL AND ${table.endReason} IS NOT NULL)
      )`,
    ),
    check(
      'manual_executions_time_check',
      sql`${table.updatedAt} >= ${table.startedAt} AND (${table.endedAt} IS NULL OR ${table.endedAt} >= ${table.startedAt})`,
    ),
  ],
);

export const executionResults = pgTable(
  'execution_results',
  {
    id: uuid('id').primaryKey(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => manualExecutions.id, { onDelete: 'restrict' }),
    workItemId: uuid('work_item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'restrict' }),
    outcome: manualExecutionStatusEnum('outcome').notNull(),
    summary: text('summary').notNull(),
    changedFiles: jsonb('changed_files').notNull().default(sql`'[]'::jsonb`),
    changeSet: jsonb('change_set'),
    commitReference: text('commit_reference'),
    needsHumanDecision: boolean('needs_human_decision').default(false).notNull(),
    humanDecision: jsonb('human_decision'),
    sessionReference: jsonb('session_reference'),
    actualCost: jsonb('actual_cost'),
    durationMs: bigint('duration_ms', { mode: 'number' }),
    verificationSource: verificationSourceEnum('verification_source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    artifactCount: integer('artifact_count').notNull(),
    testCount: integer('test_count').notNull(),
    testArtifactLinkCount: integer('test_artifact_link_count').notNull(),
    knownIssueCount: integer('known_issue_count').notNull(),
  },
  (table) => [
    unique('execution_results_execution_id_unique').on(table.executionId),
    index('execution_results_work_item_created_idx').on(
      table.workItemId,
      table.createdAt,
      table.id,
    ),
    check(
      'execution_results_terminal_outcome',
      sql`${table.outcome} IN ('completed', 'failed', 'cancelled')`,
    ),
    check('execution_results_summary_non_blank', sql`length(btrim(${table.summary})) > 0`),
    check('execution_results_changed_files_array', sql`jsonb_typeof(${table.changedFiles}) = 'array'`),
    check('execution_results_duration_non_negative', sql`${table.durationMs} IS NULL OR ${table.durationMs} >= 0`),
    check('execution_results_artifact_count_non_negative', sql`${table.artifactCount} >= 0`),
    check('execution_results_test_count_non_negative', sql`${table.testCount} >= 0`),
    check('execution_results_link_count_non_negative', sql`${table.testArtifactLinkCount} >= 0`),
    check('execution_results_issue_count_non_negative', sql`${table.knownIssueCount} >= 0`),
    check(
      'execution_results_decision_check',
      sql`${table.needsHumanDecision} = (${table.humanDecision} IS NOT NULL)`,
    ),
  ],
);

export const resultArtifacts = pgTable(
  'result_artifacts',
  {
    id: uuid('id').primaryKey(),
    resultId: uuid('result_id')
      .notNull()
      .references(() => executionResults.id, { onDelete: 'restrict' }),
    kind: artifactKindEnum('kind').notNull(),
    name: text('name').notNull(),
    uri: text('uri').notNull(),
    mediaType: text('media_type'),
    digestAlgorithm: text('digest_algorithm'),
    digestValue: text('digest_value'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  },
  (table) => [
    unique('result_artifacts_result_id_id_unique').on(table.resultId, table.id),
    check('result_artifacts_name_non_blank', sql`length(btrim(${table.name})) > 0`),
    check('result_artifacts_uri_non_blank', sql`length(btrim(${table.uri})) > 0`),
    check(
      'result_artifacts_digest_algorithm',
      sql`${table.digestAlgorithm} IS NULL OR ${table.digestAlgorithm} = 'sha256'`,
    ),
    check(
      'result_artifacts_digest_pair',
      sql`(${table.digestAlgorithm} IS NULL) = (${table.digestValue} IS NULL)`,
    ),
    check('result_artifacts_size_non_negative', sql`${table.sizeBytes} IS NULL OR ${table.sizeBytes} >= 0`),
  ],
);

export const executionTestResults = pgTable(
  'execution_test_results',
  {
    id: uuid('id').primaryKey(),
    resultId: uuid('result_id')
      .notNull()
      .references(() => executionResults.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    status: executionTestStatusEnum('status').notNull(),
    command: text('command'),
    details: text('details'),
  },
  (table) => [
    unique('execution_test_results_result_id_id_unique').on(table.resultId, table.id),
    check('execution_test_results_name_non_blank', sql`length(btrim(${table.name})) > 0`),
  ],
);

export const testResultArtifacts = pgTable(
  'test_result_artifacts',
  {
    resultId: uuid('result_id').notNull(),
    testResultId: uuid('test_result_id').notNull(),
    artifactId: uuid('artifact_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.testResultId, table.artifactId] }),
    foreignKey({
      columns: [table.resultId, table.testResultId],
      foreignColumns: [executionTestResults.resultId, executionTestResults.id],
      name: 'test_result_artifacts_test_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [table.resultId, table.artifactId],
      foreignColumns: [resultArtifacts.resultId, resultArtifacts.id],
      name: 'test_result_artifacts_artifact_fk',
    }).onDelete('restrict'),
  ],
);

export const resultKnownIssues = pgTable(
  'result_known_issues',
  {
    id: uuid('id').primaryKey(),
    resultId: uuid('result_id')
      .notNull()
      .references(() => executionResults.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description').notNull(),
    severity: issueSeverityEnum('severity').notNull(),
    blocking: boolean('blocking').notNull(),
  },
  (table) => [
    unique('result_known_issues_result_id_id_unique').on(table.resultId, table.id),
    check('result_known_issues_title_non_blank', sql`length(btrim(${table.title})) > 0`),
    check(
      'result_known_issues_description_non_blank',
      sql`length(btrim(${table.description})) > 0`,
    ),
  ],
);
