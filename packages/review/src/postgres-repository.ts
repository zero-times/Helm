import { and, eq, schema, sql, type Database } from '@helm/database';
import type { ManualExecution } from '@helm/execution';

import {
  DuplicateReviewError,
  GateNotFoundError,
  GateVersionConflictError,
  ReviewNotFoundError,
  ReviewValidationError,
  ReviewVersionConflictError,
  ReworkNotFoundError,
  ReworkVersionConflictError,
} from './errors.ts';
import type { ReviewRepository } from './repository.ts';
import type { HumanGate, Review, ReworkRequest } from './types.ts';

function toReview(row: typeof schema.reviews.$inferSelect): Review {
  return Object.freeze({
    id: row.id,
    resultId: row.resultId,
    executionId: row.executionId,
    workItemId: row.workItemId,
    graphVersion: row.graphVersion,
    reviewerMemberId: row.reviewerMemberId,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionComment: row.decisionComment,
    version: row.version,
  });
}

function toGate(row: typeof schema.humanGates.$inferSelect): HumanGate {
  return Object.freeze({
    id: row.id,
    reviewId: row.reviewId,
    workItemId: row.workItemId,
    graphVersion: row.graphVersion,
    status: row.status,
    openedAt: row.openedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    version: row.version,
  });
}

function toRework(row: typeof schema.reworkRequests.$inferSelect): ReworkRequest {
  return Object.freeze({
    id: row.id,
    rejectedReviewId: row.rejectedReviewId,
    previousExecutionId: row.previousExecutionId,
    previousResultId: row.previousResultId,
    workItemId: row.workItemId,
    graphVersion: row.graphVersion,
    reason: row.reason,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    newExecutionId: row.newExecutionId,
    startedAt: row.startedAt?.toISOString() ?? null,
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

export class PostgresReviewRepository implements ReviewRepository {
  constructor(readonly database: Database) {}

  async insertPending(review: Review, gate: HumanGate): Promise<void> {
    try {
      await this.database.transaction(async (tx) => {
        await tx.insert(schema.reviews).values({
          id: review.id,
          resultId: review.resultId,
          executionId: review.executionId,
          workItemId: review.workItemId,
          graphVersion: review.graphVersion,
          reviewerMemberId: review.reviewerMemberId,
          status: review.status,
          requestedAt: new Date(review.requestedAt),
          decidedAt: null,
          decisionComment: null,
          version: review.version,
        });
        await tx.insert(schema.humanGates).values({
          id: gate.id,
          reviewId: gate.reviewId,
          workItemId: gate.workItemId,
          graphVersion: gate.graphVersion,
          status: gate.status,
          openedAt: new Date(gate.openedAt),
          resolvedAt: null,
          version: gate.version,
        });
      });
    } catch (error) {
      if (isDatabaseError(error, '23505')) throw new DuplicateReviewError(review.resultId);
      throw error;
    }
  }

  async decide(
    review: Review,
    gate: HumanGate,
    rework: ReworkRequest | undefined,
    expectedReviewVersion: number,
    expectedGateVersion: number,
  ): Promise<void> {
    await this.database.transaction(async (tx) => {
      const updatedReviews = await tx
        .update(schema.reviews)
        .set({
          status: review.status,
          decidedAt: review.decidedAt ? new Date(review.decidedAt) : null,
          decisionComment: review.decisionComment,
          version: review.version,
        })
        .where(
          and(
            eq(schema.reviews.id, review.id),
            eq(schema.reviews.version, expectedReviewVersion),
            eq(schema.reviews.status, 'pending'),
          ),
        )
        .returning({ id: schema.reviews.id });
      if (!updatedReviews[0]) {
        const rows = await tx
          .select({ version: schema.reviews.version })
          .from(schema.reviews)
          .where(eq(schema.reviews.id, review.id))
          .limit(1);
        if (!rows[0]) throw new ReviewNotFoundError(review.id);
        throw new ReviewVersionConflictError(
          review.id,
          expectedReviewVersion,
          rows[0].version,
        );
      }

      const updatedGates = await tx
        .update(schema.humanGates)
        .set({
          status: gate.status,
          resolvedAt: gate.resolvedAt ? new Date(gate.resolvedAt) : null,
          version: gate.version,
        })
        .where(
          and(
            eq(schema.humanGates.id, gate.id),
            eq(schema.humanGates.version, expectedGateVersion),
            eq(schema.humanGates.status, 'pending'),
          ),
        )
        .returning({ id: schema.humanGates.id });
      if (!updatedGates[0]) {
        const rows = await tx
          .select({ version: schema.humanGates.version })
          .from(schema.humanGates)
          .where(eq(schema.humanGates.id, gate.id))
          .limit(1);
        if (!rows[0]) throw new GateNotFoundError(gate.id);
        throw new GateVersionConflictError(gate.id, expectedGateVersion, rows[0].version);
      }

      if (rework) {
        await tx.insert(schema.reworkRequests).values({
          id: rework.id,
          rejectedReviewId: rework.rejectedReviewId,
          previousExecutionId: rework.previousExecutionId,
          previousResultId: rework.previousResultId,
          workItemId: rework.workItemId,
          graphVersion: rework.graphVersion,
          reason: rework.reason,
          status: rework.status,
          requestedAt: new Date(rework.requestedAt),
          newExecutionId: null,
          startedAt: null,
          version: rework.version,
        });
      }
    });
  }

  async startRework(
    rework: ReworkRequest,
    execution: ManualExecution,
    expectedVersion: number,
  ): Promise<void> {
    try {
      await this.database.transaction(async (tx) => {
        const currentRows = await tx
          .select()
          .from(schema.reworkRequests)
          .where(eq(schema.reworkRequests.id, rework.id))
          .limit(1);
        const current = currentRows[0];
        if (!current) throw new ReworkNotFoundError(rework.id);
        if (current.version !== expectedVersion) {
          throw new ReworkVersionConflictError(rework.id, expectedVersion, current.version);
        }

        await tx.execute(
          sql`select set_config('helm.rework_request_id', ${rework.id}, true)`,
        );

        await tx.insert(schema.manualExecutions).values({
          id: execution.id,
          workItemId: execution.workItemId,
          graphVersion: execution.graphVersion,
          mode: execution.mode,
          executorMemberId: execution.executorMemberId,
          status: execution.status,
          startedAt: new Date(execution.startedAt),
          updatedAt: new Date(execution.updatedAt),
          endedAt: null,
          waitingReason: null,
          endReason: null,
          version: execution.version,
        });

        const updated = await tx
          .update(schema.reworkRequests)
          .set({
            status: rework.status,
            newExecutionId: rework.newExecutionId,
            startedAt: rework.startedAt ? new Date(rework.startedAt) : null,
            version: rework.version,
          })
          .where(
            and(
              eq(schema.reworkRequests.id, rework.id),
              eq(schema.reworkRequests.status, 'requested'),
              eq(schema.reworkRequests.version, expectedVersion),
            ),
          )
          .returning({ id: schema.reworkRequests.id });
        if (!updated[0]) {
          throw new ReworkVersionConflictError(rework.id, expectedVersion, current.version);
        }
      });
    } catch (error) {
      if (isDatabaseError(error, '23505')) {
        throw new ReviewValidationError(`Execution ${execution.id} already exists`);
      }
      throw error;
    }
  }

  async findReview(reviewId: string): Promise<Review | undefined> {
    const rows = await this.database
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.id, reviewId))
      .limit(1);
    return rows[0] ? toReview(rows[0]) : undefined;
  }

  async findGate(gateId: string): Promise<HumanGate | undefined> {
    const rows = await this.database
      .select()
      .from(schema.humanGates)
      .where(eq(schema.humanGates.id, gateId))
      .limit(1);
    return rows[0] ? toGate(rows[0]) : undefined;
  }

  async findGateByReviewId(reviewId: string): Promise<HumanGate | undefined> {
    const rows = await this.database
      .select()
      .from(schema.humanGates)
      .where(eq(schema.humanGates.reviewId, reviewId))
      .limit(1);
    return rows[0] ? toGate(rows[0]) : undefined;
  }

  async findRework(reworkId: string): Promise<ReworkRequest | undefined> {
    const rows = await this.database
      .select()
      .from(schema.reworkRequests)
      .where(eq(schema.reworkRequests.id, reworkId))
      .limit(1);
    return rows[0] ? toRework(rows[0]) : undefined;
  }

  async listReviewsForWorkItem(workItemId: string): Promise<readonly Review[]> {
    const rows = await this.database
      .select()
      .from(schema.reviews)
      .where(eq(schema.reviews.workItemId, workItemId));
    return Object.freeze(
      rows.map(toReview).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.id.localeCompare(b.id)),
    );
  }

  async listGatesForWorkItem(workItemId: string): Promise<readonly HumanGate[]> {
    const rows = await this.database
      .select()
      .from(schema.humanGates)
      .where(eq(schema.humanGates.workItemId, workItemId));
    return Object.freeze(
      rows.map(toGate).sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.id.localeCompare(b.id)),
    );
  }

  async listReworksForWorkItem(workItemId: string): Promise<readonly ReworkRequest[]> {
    const rows = await this.database
      .select()
      .from(schema.reworkRequests)
      .where(eq(schema.reworkRequests.workItemId, workItemId));
    return Object.freeze(
      rows.map(toRework).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.id.localeCompare(b.id)),
    );
  }
}
