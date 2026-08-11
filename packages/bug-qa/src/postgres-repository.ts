import { and, eq, schema, type Database } from '@helm/database';
import { HumanGatePolicy } from '@helm/review';
import { PostgresReviewRepository } from '@helm/review/postgres';

import {
  BugNotFoundError,
  BugValidationError,
  BugVersionConflictError,
  DuplicateBugRecordError,
  QaRegressionNotFoundError,
  QaRegressionVersionConflictError,
} from './errors.ts';
import type { BugRepository } from './repository.ts';
import type {
  BugFixEdge,
  BugWorkItem,
  PassedReviewGateInput,
  PassedReviewGateReader,
  QaRegressionEdge,
} from './types.ts';

type BugReadDatabase = Pick<Database, 'select'>;

function toBug(row: typeof schema.bugWorkItems.$inferSelect): BugWorkItem {
  return Object.freeze({
    id: row.id,
    sourceRequirementId: row.sourceRequirementId,
    graphVersion: row.graphVersion,
    title: row.title,
    description: row.description,
    discoveredIn: row.discoveredIn,
    severity: row.severity,
    blocking: row.blocking,
    reporterMemberId: row.reporterMemberId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    version: row.version,
  });
}

function toFix(row: typeof schema.bugFixEdges.$inferSelect): BugFixEdge {
  return Object.freeze({
    id: row.id,
    bugId: row.bugId,
    executionId: row.executionId,
    resultId: row.resultId,
    reviewId: row.reviewId,
    passedGateId: row.passedGateId,
    fixedAt: row.fixedAt.toISOString(),
  });
}

function toRegression(
  row: typeof schema.qaRegressionEdges.$inferSelect,
): QaRegressionEdge {
  return Object.freeze({
    id: row.id,
    bugId: row.bugId,
    fixEdgeId: row.fixEdgeId,
    qaMemberId: row.qaMemberId,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    notes: row.notes,
    version: row.version,
  });
}

function isDatabaseError(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

export class PostgresBugRepository implements BugRepository {
  constructor(readonly database: Database) {}

  async insertBug(bug: BugWorkItem): Promise<void> {
    try {
      await this.database.insert(schema.bugWorkItems).values({
        id: bug.id,
        sourceRequirementId: bug.sourceRequirementId,
        graphVersion: bug.graphVersion,
        title: bug.title,
        description: bug.description,
        discoveredIn: bug.discoveredIn,
        severity: bug.severity,
        blocking: bug.blocking,
        reporterMemberId: bug.reporterMemberId,
        status: bug.status,
        createdAt: new Date(bug.createdAt),
        updatedAt: new Date(bug.updatedAt),
        closedAt: null,
        version: bug.version,
      });
    } catch (error) {
      if (isDatabaseError(error, '23505')) throw new DuplicateBugRecordError(bug.id);
      throw error;
    }
  }

  async saveBug(bug: BugWorkItem, expectedVersion: number): Promise<void> {
    const updated = await this.database
      .update(schema.bugWorkItems)
      .set({
        status: bug.status,
        blocking: bug.blocking,
        updatedAt: new Date(bug.updatedAt),
        closedAt: bug.closedAt ? new Date(bug.closedAt) : null,
        version: bug.version,
      })
      .where(
        and(
          eq(schema.bugWorkItems.id, bug.id),
          eq(schema.bugWorkItems.version, expectedVersion),
        ),
      )
      .returning({ id: schema.bugWorkItems.id });
    if (!updated[0]) await this.#throwBugWriteFailure(bug.id, expectedVersion);
  }

  async submitFixForQa(
    bug: BugWorkItem,
    fix: BugFixEdge,
    regression: QaRegressionEdge,
    expectedBugVersion: number,
  ): Promise<void> {
    try {
      await this.database.transaction(async (tx) => {
        const updated = await tx
          .update(schema.bugWorkItems)
          .set({
            status: bug.status,
            updatedAt: new Date(bug.updatedAt),
            version: bug.version,
          })
          .where(
            and(
              eq(schema.bugWorkItems.id, bug.id),
              eq(schema.bugWorkItems.version, expectedBugVersion),
            ),
          )
          .returning({ id: schema.bugWorkItems.id });
        if (!updated[0]) await this.#throwBugWriteFailure(bug.id, expectedBugVersion, tx);

        await tx.insert(schema.bugFixEdges).values({
          id: fix.id,
          bugId: fix.bugId,
          executionId: fix.executionId,
          resultId: fix.resultId,
          reviewId: fix.reviewId,
          passedGateId: fix.passedGateId,
          fixedAt: new Date(fix.fixedAt),
        });
        await tx.insert(schema.qaRegressionEdges).values({
          id: regression.id,
          bugId: regression.bugId,
          fixEdgeId: regression.fixEdgeId,
          qaMemberId: regression.qaMemberId,
          status: regression.status,
          requestedAt: new Date(regression.requestedAt),
          completedAt: null,
          notes: null,
          version: regression.version,
        });
      });
    } catch (error) {
      if (isDatabaseError(error, '23505')) throw new DuplicateBugRecordError(fix.id);
      throw error;
    }
  }

  async completeRegression(
    bug: BugWorkItem,
    regression: QaRegressionEdge,
    expectedBugVersion: number,
    expectedRegressionVersion: number,
  ): Promise<void> {
    await this.database.transaction(async (tx) => {
      const updatedBug = await tx
        .update(schema.bugWorkItems)
        .set({
          status: bug.status,
          blocking: bug.blocking,
          updatedAt: new Date(bug.updatedAt),
          closedAt: bug.closedAt ? new Date(bug.closedAt) : null,
          version: bug.version,
        })
        .where(
          and(
            eq(schema.bugWorkItems.id, bug.id),
            eq(schema.bugWorkItems.version, expectedBugVersion),
          ),
        )
        .returning({ id: schema.bugWorkItems.id });
      if (!updatedBug[0]) {
        await this.#throwBugWriteFailure(bug.id, expectedBugVersion, tx);
      }

      const updatedRegression = await tx
        .update(schema.qaRegressionEdges)
        .set({
          status: regression.status,
          completedAt: regression.completedAt
            ? new Date(regression.completedAt)
            : null,
          notes: regression.notes,
          version: regression.version,
        })
        .where(
          and(
            eq(schema.qaRegressionEdges.id, regression.id),
            eq(schema.qaRegressionEdges.version, expectedRegressionVersion),
          ),
        )
        .returning({ id: schema.qaRegressionEdges.id });
      if (!updatedRegression[0]) {
        const rows = await tx
          .select({ version: schema.qaRegressionEdges.version })
          .from(schema.qaRegressionEdges)
          .where(eq(schema.qaRegressionEdges.id, regression.id))
          .limit(1);
        if (!rows[0]) throw new QaRegressionNotFoundError(regression.id);
        throw new QaRegressionVersionConflictError(
          regression.id,
          expectedRegressionVersion,
          rows[0].version,
        );
      }
    });
  }

  async findBug(bugId: string): Promise<BugWorkItem | undefined> {
    const rows = await this.database
      .select()
      .from(schema.bugWorkItems)
      .where(eq(schema.bugWorkItems.id, bugId))
      .limit(1);
    return rows[0] ? toBug(rows[0]) : undefined;
  }

  async findRegression(regressionId: string): Promise<QaRegressionEdge | undefined> {
    const rows = await this.database
      .select()
      .from(schema.qaRegressionEdges)
      .where(eq(schema.qaRegressionEdges.id, regressionId))
      .limit(1);
    return rows[0] ? toRegression(rows[0]) : undefined;
  }

  async listBugsForRequirement(requirementId: string): Promise<readonly BugWorkItem[]> {
    const rows = await this.database
      .select()
      .from(schema.bugWorkItems)
      .where(eq(schema.bugWorkItems.sourceRequirementId, requirementId))
      .orderBy(schema.bugWorkItems.createdAt, schema.bugWorkItems.id);
    return Object.freeze(rows.map(toBug));
  }

  async listFixesForBug(bugId: string): Promise<readonly BugFixEdge[]> {
    const rows = await this.database
      .select()
      .from(schema.bugFixEdges)
      .where(eq(schema.bugFixEdges.bugId, bugId))
      .orderBy(schema.bugFixEdges.fixedAt, schema.bugFixEdges.id);
    return Object.freeze(rows.map(toFix));
  }

  async listRegressionsForBug(bugId: string): Promise<readonly QaRegressionEdge[]> {
    const rows = await this.database
      .select()
      .from(schema.qaRegressionEdges)
      .where(eq(schema.qaRegressionEdges.bugId, bugId))
      .orderBy(schema.qaRegressionEdges.requestedAt, schema.qaRegressionEdges.id);
    return Object.freeze(rows.map(toRegression));
  }

  async listBlockingBugsForRequirement(
    requirementId: string,
  ): Promise<readonly BugWorkItem[]> {
    const rows = await this.database
      .select()
      .from(schema.bugWorkItems)
      .where(
        and(
          eq(schema.bugWorkItems.sourceRequirementId, requirementId),
          eq(schema.bugWorkItems.blocking, true),
        ),
      )
      .orderBy(schema.bugWorkItems.createdAt, schema.bugWorkItems.id);
    return Object.freeze(rows.filter((row) => row.status !== 'closed').map(toBug));
  }

  async #throwBugWriteFailure(
    bugId: string,
    expectedVersion: number,
    database: BugReadDatabase = this.database,
  ): Promise<never> {
    const rows = await database
      .select({ version: schema.bugWorkItems.version })
      .from(schema.bugWorkItems)
      .where(eq(schema.bugWorkItems.id, bugId))
      .limit(1);
    if (!rows[0]) throw new BugNotFoundError(bugId);
    throw new BugVersionConflictError(bugId, expectedVersion, rows[0].version);
  }
}

export class PostgresPassedReviewGateReader implements PassedReviewGateReader {
  readonly #policy: HumanGatePolicy;

  constructor(readonly database: Database) {
    this.#policy = new HumanGatePolicy(new PostgresReviewRepository(database));
  }

  async assertReviewedWorkItemCanComplete(
    input: PassedReviewGateInput,
  ): Promise<void> {
    const rows = await this.database
      .select({
        workItemId: schema.manualExecutions.workItemId,
        graphVersion: schema.manualExecutions.graphVersion,
        requirementId: schema.workGraphs.requirementId,
      })
      .from(schema.manualExecutions)
      .innerJoin(
        schema.executionResults,
        and(
          eq(schema.executionResults.id, input.resultId),
          eq(schema.executionResults.executionId, schema.manualExecutions.id),
        ),
      )
      .innerJoin(
        schema.reviews,
        and(
          eq(schema.reviews.id, input.reviewId),
          eq(schema.reviews.resultId, schema.executionResults.id),
          eq(schema.reviews.executionId, schema.manualExecutions.id),
        ),
      )
      .innerJoin(
        schema.humanGates,
        and(
          eq(schema.humanGates.id, input.gateId),
          eq(schema.humanGates.reviewId, schema.reviews.id),
        ),
      )
      .innerJoin(
        schema.workItems,
        eq(schema.workItems.id, schema.manualExecutions.workItemId),
      )
      .innerJoin(
        schema.graphNodes,
        eq(schema.graphNodes.id, schema.workItems.graphNodeId),
      )
      .innerJoin(schema.workGraphs, eq(schema.workGraphs.id, schema.graphNodes.graphId))
      .where(eq(schema.manualExecutions.id, input.executionId))
      .limit(1);
    const chain = rows[0];
    if (
      !chain ||
      chain.requirementId !== input.sourceRequirementId ||
      chain.graphVersion !== input.graphVersion
    ) {
      throw new BugValidationError(
        `Bug ${input.bugId} fix does not match one Review chain in its Requirement graph`,
      );
    }
    await this.#policy.assertReviewedWorkItemCanComplete({
      gateId: input.gateId,
      workItemId: chain.workItemId,
      graphVersion: chain.graphVersion,
    });
  }
}
