import { and, eq, schema, type Database } from '@helm/database';

import {
  ExecutionNotFoundError,
  ExecutionVersionConflictError,
} from './errors.ts';
import type { ExecutionRepository } from './repository.ts';
import type {
  ArtifactReference,
  ChangeSetReference,
  ExecutionResult,
  HumanDecision,
  JsonValue,
  ManualExecution,
  Money,
  SessionReference,
  TestResultReference,
} from './types.ts';

type DatabaseExecutor = Pick<Database, 'select'>;

function toExecution(
  row: typeof schema.manualExecutions.$inferSelect,
): ManualExecution {
  return Object.freeze({
    id: row.id,
    workItemId: row.workItemId,
    graphVersion: row.graphVersion,
    mode: row.mode,
    executorMemberId: row.executorMemberId,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    waitingReason: row.waitingReason,
    endReason: row.endReason,
    version: row.version,
  });
}

function freezeArray<T>(items: readonly T[]): readonly T[] {
  return Object.freeze(items);
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function freezeJson<T extends JsonValue>(value: T): T {
  if (isJsonArray(value)) {
    return Object.freeze(value.map((item) => freezeJson(item))) as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          freezeJson(item),
        ]),
      ),
    ) as T;
  }
  return value;
}

async function loadResult(
  executor: DatabaseExecutor,
  row: typeof schema.executionResults.$inferSelect,
): Promise<ExecutionResult> {
  const [artifactRows, testRows, linkRows, issueRows] = await Promise.all([
    executor
      .select()
      .from(schema.resultArtifacts)
      .where(eq(schema.resultArtifacts.resultId, row.id)),
    executor
      .select()
      .from(schema.executionTestResults)
      .where(eq(schema.executionTestResults.resultId, row.id)),
    executor
      .select()
      .from(schema.testResultArtifacts)
      .where(eq(schema.testResultArtifacts.resultId, row.id)),
    executor
      .select()
      .from(schema.resultKnownIssues)
      .where(eq(schema.resultKnownIssues.resultId, row.id)),
  ]);
  const artifactIdsByTest = new Map<string, string[]>();
  for (const link of linkRows) {
    const artifactIds = artifactIdsByTest.get(link.testResultId) ?? [];
    artifactIds.push(link.artifactId);
    artifactIdsByTest.set(link.testResultId, artifactIds);
  }
  const artifacts: readonly ArtifactReference[] = freezeArray(
    artifactRows.map((artifact) =>
      Object.freeze({
        id: artifact.id,
        kind: artifact.kind,
        name: artifact.name,
        uri: artifact.uri,
        mediaType: artifact.mediaType,
        digest:
          artifact.digestAlgorithm === 'sha256' && artifact.digestValue !== null
            ? Object.freeze({
                algorithm: 'sha256' as const,
                value: artifact.digestValue,
              })
            : null,
        sizeBytes: artifact.sizeBytes,
        metadata: freezeJson(
          (artifact.metadata ?? {}) as Readonly<Record<string, JsonValue>>,
        ),
      }),
    ),
  );
  const tests: readonly TestResultReference[] = freezeArray(
    testRows.map((test) =>
      Object.freeze({
        id: test.id,
        name: test.name,
        status: test.status,
        command: test.command,
        details: test.details,
        artifactIds: freezeArray(artifactIdsByTest.get(test.id) ?? []),
      }),
    ),
  );

  return Object.freeze({
    id: row.id,
    executionId: row.executionId,
    workItemId: row.workItemId,
    outcome: row.outcome as ExecutionResult['outcome'],
    summary: row.summary,
    changedFiles: freezeArray(row.changedFiles as string[]),
    changeSet: row.changeSet
      ? Object.freeze(row.changeSet as ChangeSetReference)
      : null,
    commitReference: row.commitReference,
    tests,
    artifacts,
    knownIssues: freezeArray(
      issueRows.map((issue) =>
        Object.freeze({
          id: issue.id,
          title: issue.title,
          description: issue.description,
          severity: issue.severity,
          blocking: issue.blocking,
        }),
      ),
    ),
    needsHumanDecision: row.needsHumanDecision,
    humanDecision: row.humanDecision
      ? Object.freeze({
          ...(row.humanDecision as HumanDecision),
          options: freezeArray((row.humanDecision as HumanDecision).options),
        })
      : null,
    sessionReference: row.sessionReference
      ? Object.freeze(row.sessionReference as SessionReference)
      : null,
    actualCost: row.actualCost ? Object.freeze(row.actualCost as Money) : null,
    durationMs: row.durationMs,
    verificationSource: row.verificationSource,
    createdAt: row.createdAt.toISOString(),
  });
}

export class PostgresExecutionRepository implements ExecutionRepository {
  readonly database: Database;

  constructor(database: Database) {
    this.database = database;
  }

  async insertExecution(execution: ManualExecution): Promise<void> {
    await this.database.insert(schema.manualExecutions).values({
      id: execution.id,
      workItemId: execution.workItemId,
      graphVersion: execution.graphVersion,
      mode: execution.mode,
      executorMemberId: execution.executorMemberId,
      status: execution.status,
      startedAt: new Date(execution.startedAt),
      updatedAt: new Date(execution.updatedAt),
      endedAt: execution.endedAt ? new Date(execution.endedAt) : null,
      waitingReason: execution.waitingReason,
      endReason: execution.endReason,
      version: execution.version,
    });
  }

  async findExecution(executionId: string): Promise<ManualExecution | undefined> {
    const rows = await this.database
      .select()
      .from(schema.manualExecutions)
      .where(eq(schema.manualExecutions.id, executionId))
      .limit(1);
    return rows[0] ? toExecution(rows[0]) : undefined;
  }

  async saveExecution(
    execution: ManualExecution,
    expectedVersion: number,
  ): Promise<void> {
    const updated = await this.database
      .update(schema.manualExecutions)
      .set({
        status: execution.status,
        updatedAt: new Date(execution.updatedAt),
        endedAt: execution.endedAt ? new Date(execution.endedAt) : null,
        waitingReason: execution.waitingReason,
        endReason: execution.endReason,
        version: execution.version,
      })
      .where(
        and(
          eq(schema.manualExecutions.id, execution.id),
          eq(schema.manualExecutions.version, expectedVersion),
        ),
      )
      .returning({ id: schema.manualExecutions.id });
    if (!updated[0]) await this.throwWriteConflict(execution.id, expectedVersion);
  }

  async finishExecution(
    execution: ManualExecution,
    result: ExecutionResult,
    expectedVersion: number,
  ): Promise<void> {
    await this.database.transaction(async (tx) => {
      const updated = await tx
        .update(schema.manualExecutions)
        .set({
          status: execution.status,
          updatedAt: new Date(execution.updatedAt),
          endedAt: execution.endedAt ? new Date(execution.endedAt) : null,
          waitingReason: execution.waitingReason,
          endReason: execution.endReason,
          version: execution.version,
        })
        .where(
          and(
            eq(schema.manualExecutions.id, execution.id),
            eq(schema.manualExecutions.version, expectedVersion),
          ),
        )
        .returning({ id: schema.manualExecutions.id });
      if (!updated[0]) {
        const current = await tx
          .select({ version: schema.manualExecutions.version })
          .from(schema.manualExecutions)
          .where(eq(schema.manualExecutions.id, execution.id))
          .limit(1);
        if (!current[0]) throw new ExecutionNotFoundError(execution.id);
        throw new ExecutionVersionConflictError(
          execution.id,
          expectedVersion,
          current[0].version,
        );
      }

      const linkCount = result.tests.reduce(
        (count, test) => count + test.artifactIds.length,
        0,
      );
      await tx.insert(schema.executionResults).values({
        id: result.id,
        executionId: result.executionId,
        workItemId: result.workItemId,
        outcome: result.outcome,
        summary: result.summary,
        changedFiles: result.changedFiles,
        changeSet: result.changeSet,
        commitReference: result.commitReference,
        needsHumanDecision: result.needsHumanDecision,
        humanDecision: result.humanDecision,
        sessionReference: result.sessionReference,
        actualCost: result.actualCost,
        durationMs: result.durationMs,
        verificationSource: result.verificationSource,
        createdAt: new Date(result.createdAt),
        artifactCount: result.artifacts.length,
        testCount: result.tests.length,
        testArtifactLinkCount: linkCount,
        knownIssueCount: result.knownIssues.length,
      });
      if (result.artifacts.length > 0) {
        await tx.insert(schema.resultArtifacts).values(
          result.artifacts.map((artifact) => ({
            id: artifact.id,
            resultId: result.id,
            kind: artifact.kind,
            name: artifact.name,
            uri: artifact.uri,
            mediaType: artifact.mediaType,
            digestAlgorithm: artifact.digest?.algorithm ?? null,
            digestValue: artifact.digest?.value ?? null,
            sizeBytes: artifact.sizeBytes,
            metadata: artifact.metadata,
          })),
        );
      }
      if (result.tests.length > 0) {
        await tx.insert(schema.executionTestResults).values(
          result.tests.map((test) => ({
            id: test.id,
            resultId: result.id,
            name: test.name,
            status: test.status,
            command: test.command,
            details: test.details,
          })),
        );
      }
      const links = result.tests.flatMap((test) =>
        test.artifactIds.map((artifactId) => ({
          resultId: result.id,
          testResultId: test.id,
          artifactId,
        })),
      );
      if (links.length > 0) {
        await tx.insert(schema.testResultArtifacts).values(links);
      }
      if (result.knownIssues.length > 0) {
        await tx.insert(schema.resultKnownIssues).values(
          result.knownIssues.map((issue) => ({
            id: issue.id,
            resultId: result.id,
            title: issue.title,
            description: issue.description,
            severity: issue.severity,
            blocking: issue.blocking,
          })),
        );
      }
    });
  }

  async findResultByExecutionId(
    executionId: string,
  ): Promise<ExecutionResult | undefined> {
    const rows = await this.database
      .select()
      .from(schema.executionResults)
      .where(eq(schema.executionResults.executionId, executionId))
      .limit(1);
    return rows[0] ? loadResult(this.database, rows[0]) : undefined;
  }

  async listExecutionsForWorkItem(
    workItemId: string,
  ): Promise<readonly ManualExecution[]> {
    const rows = await this.database
      .select()
      .from(schema.manualExecutions)
      .where(eq(schema.manualExecutions.workItemId, workItemId))
      .orderBy(schema.manualExecutions.startedAt, schema.manualExecutions.id);
    return freezeArray(rows.map(toExecution));
  }

  async listResultsForWorkItem(
    workItemId: string,
  ): Promise<readonly ExecutionResult[]> {
    const rows = await this.database
      .select()
      .from(schema.executionResults)
      .where(eq(schema.executionResults.workItemId, workItemId))
      .orderBy(schema.executionResults.createdAt, schema.executionResults.id);
    return freezeArray(await Promise.all(rows.map((row) => loadResult(this.database, row))));
  }

  private async throwWriteConflict(
    executionId: string,
    expectedVersion: number,
  ): Promise<never> {
    const current = await this.findExecution(executionId);
    if (!current) throw new ExecutionNotFoundError(executionId);
    throw new ExecutionVersionConflictError(
      executionId,
      expectedVersion,
      current.version,
    );
  }
}
