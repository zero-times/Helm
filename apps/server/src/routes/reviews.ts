import { randomUUID } from 'node:crypto';

import { ConflictError, NotFoundError } from '@helm/core-domain';
import { and, eq, schema, type Database } from '@helm/database';
import type { JsonValue } from '@helm/audit-events';
import type { ManualExecutionStartGuard } from '@helm/execution';
import { PostgresExecutionRepository } from '@helm/execution/postgres';
import { ReviewWorkflowService } from '@helm/review';
import { PostgresReviewRepository } from '@helm/review/postgres';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

import { executeAuditedCommand } from '../audited-command';

const uuidParams = z.object({ id: z.string().uuid() });
const timestamp = z.string().datetime({ offset: true });
const decisionBody = z.object({
  expectedReviewVersion: z.number().int().positive(),
  expectedGateVersion: z.number().int().positive(),
  occurredAt: timestamp.optional(),
});
const commandHeaders = z.object({
  'idempotency-key': z.string().trim().min(1).optional(),
  'x-actor-member-id': z.string().uuid().optional(),
  'x-command-source': z.string().trim().min(1).optional(),
});

export interface ReviewRoutesOptions {
  database: Database;
}

class DatabaseReworkStartGuard implements ManualExecutionStartGuard {
  constructor(readonly database: Database) {}

  async assertCanStart(input: {
    workItemId: string;
    graphVersion: number;
    executorMemberId: string;
  }): Promise<void> {
    const rows = await this.database
      .select({
        status: schema.workItems.status,
        graphVersion: schema.workGraphs.graphVersion,
        organizationId: schema.projects.organizationId,
      })
      .from(schema.workItems)
      .innerJoin(schema.graphNodes, eq(schema.graphNodes.id, schema.workItems.graphNodeId))
      .innerJoin(schema.workGraphs, eq(schema.workGraphs.id, schema.graphNodes.graphId))
      .innerJoin(
        schema.requirements,
        eq(schema.requirements.id, schema.workGraphs.requirementId),
      )
      .innerJoin(schema.projects, eq(schema.projects.id, schema.requirements.projectId))
      .where(eq(schema.workItems.id, input.workItemId))
      .limit(1);
    const item = rows[0];
    if (!item) throw new NotFoundError('WorkItem', input.workItemId);
    if (item.graphVersion !== input.graphVersion) {
      throw new ConflictError(
        `Expected graph version ${input.graphVersion}, got ${item.graphVersion}`,
      );
    }
    if (item.status !== 'in_progress') {
      throw new ConflictError(
        `Rework requires WorkItem ${input.workItemId} to remain in_progress; got ${item.status}`,
      );
    }
    const [member, requestedRework] = await Promise.all([
      this.database
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(
          and(
            eq(schema.members.id, input.executorMemberId),
            eq(schema.members.organizationId, item.organizationId),
          ),
        )
        .limit(1),
      this.database
        .select({ id: schema.reworkRequests.id })
        .from(schema.reworkRequests)
        .where(
          and(
            eq(schema.reworkRequests.workItemId, input.workItemId),
            eq(schema.reworkRequests.graphVersion, input.graphVersion),
            eq(schema.reworkRequests.status, 'requested'),
          ),
        )
        .limit(1),
    ]);
    if (!member[0]) {
      throw new ConflictError(
        `Executor ${input.executorMemberId} must belong to the WorkItem organization`,
      );
    }
    if (!requestedRework[0]) {
      throw new ConflictError(`WorkItem ${input.workItemId} has no requested Rework`);
    }
  }
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

async function executionContext(database: Database, executionId: string) {
  const rows = await database
    .select({
      workItemId: schema.manualExecutions.workItemId,
      organizationId: schema.projects.organizationId,
      accountableHumanId: schema.requirements.accountableHumanId,
      graphVersion: schema.manualExecutions.graphVersion,
    })
    .from(schema.manualExecutions)
    .innerJoin(schema.workItems, eq(schema.workItems.id, schema.manualExecutions.workItemId))
    .innerJoin(schema.graphNodes, eq(schema.graphNodes.id, schema.workItems.graphNodeId))
    .innerJoin(schema.workGraphs, eq(schema.workGraphs.id, schema.graphNodes.graphId))
    .innerJoin(schema.requirements, eq(schema.requirements.id, schema.workGraphs.requirementId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.requirements.projectId))
    .where(eq(schema.manualExecutions.id, executionId))
    .limit(1);
  const context = rows[0];
  if (!context) throw new NotFoundError('Execution', executionId);
  return context;
}

async function reviewContext(database: Database, reviewId: string) {
  const rows = await database
    .select({
      workItemId: schema.reviews.workItemId,
      executionId: schema.reviews.executionId,
      organizationId: schema.projects.organizationId,
      accountableHumanId: schema.requirements.accountableHumanId,
      graphVersion: schema.reviews.graphVersion,
    })
    .from(schema.reviews)
    .innerJoin(schema.workItems, eq(schema.workItems.id, schema.reviews.workItemId))
    .innerJoin(schema.graphNodes, eq(schema.graphNodes.id, schema.workItems.graphNodeId))
    .innerJoin(schema.workGraphs, eq(schema.workGraphs.id, schema.graphNodes.graphId))
    .innerJoin(schema.requirements, eq(schema.requirements.id, schema.workGraphs.requirementId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.requirements.projectId))
    .where(eq(schema.reviews.id, reviewId))
    .limit(1);
  const context = rows[0];
  if (!context) throw new NotFoundError('Review', reviewId);
  return context;
}

async function reworkContext(database: Database, reworkRequestId: string) {
  const rows = await database
    .select({
      workItemId: schema.reworkRequests.workItemId,
      organizationId: schema.projects.organizationId,
      accountableHumanId: schema.requirements.accountableHumanId,
      graphVersion: schema.reworkRequests.graphVersion,
    })
    .from(schema.reworkRequests)
    .innerJoin(schema.workItems, eq(schema.workItems.id, schema.reworkRequests.workItemId))
    .innerJoin(schema.graphNodes, eq(schema.graphNodes.id, schema.workItems.graphNodeId))
    .innerJoin(schema.workGraphs, eq(schema.workGraphs.id, schema.graphNodes.graphId))
    .innerJoin(schema.requirements, eq(schema.requirements.id, schema.workGraphs.requirementId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.requirements.projectId))
    .where(eq(schema.reworkRequests.id, reworkRequestId))
    .limit(1);
  const context = rows[0];
  if (!context) throw new NotFoundError('ReworkRequest', reworkRequestId);
  return context;
}

export const reviewRoutes: FastifyPluginCallback<ReviewRoutesOptions> = (
  server,
  options,
  done,
) => {
  const repository = new PostgresReviewRepository(options.database);

  server.post('/api/executions/:id/reviews', async (request, reply) => {
    const { id: executionId } = uuidParams.parse(request.params);
    const headers = commandHeaders.parse(request.headers);
    const body = z
      .object({
        reviewerMemberId: z.string().uuid(),
        requestedAt: timestamp.optional(),
      })
      .parse(request.body);
    const context = await executionContext(options.database, executionId);
    const reviewId = randomUUID();
    const gateId = randomUUID();
    const outcome = await executeAuditedCommand(options.database, {
      organizationId: context.organizationId,
      commandType: 'RequestReview',
      idempotencyKey: headers['idempotency-key'] ?? request.id,
      actorMemberId: headers['x-actor-member-id'] ?? body.reviewerMemberId,
      source: headers['x-command-source'] ?? 'human',
      payload: toJson(body),
      entityType: 'review', entityId: reviewId, executionId,
      workItemId: context.workItemId, graphVersion: context.graphVersion,
      eventType: 'Review.Requested', category: 'review',
      summary: 'Human review requested',
      mutate: async (tx) => {
        const txDatabase = tx as unknown as Database;
        const txService = new ReviewWorkflowService(
          new PostgresReviewRepository(txDatabase),
          new PostgresExecutionRepository(txDatabase),
          new DatabaseReworkStartGuard(txDatabase),
        );
        const created = await txService.requestReview({
          reviewId, gateId, executionId,
          reviewerMemberId: body.reviewerMemberId,
          requestedAt: body.requestedAt ?? new Date(),
        });
        return { result: toJson(created), entityVersion: created.review.version };
      },
    });
    void reply.header('Idempotency-Replayed', String(outcome.replayed));
    void reply.code(201);
    return outcome.result;
  });

  server.get('/api/reviews/:id', async (request) => {
    const { id } = uuidParams.parse(request.params);
    const review = await repository.findReview(id);
    if (!review) throw new NotFoundError('Review', id);
    return { review, gate: await repository.findGateByReviewId(id) };
  });

  server.get('/api/work-items/:id/reviews', async (request) => {
    const { id: workItemId } = uuidParams.parse(request.params);
    return {
      reviews: await repository.listReviewsForWorkItem(workItemId),
      gates: await repository.listGatesForWorkItem(workItemId),
      reworks: await repository.listReworksForWorkItem(workItemId),
    };
  });

  server.post('/api/reviews/:id/approve', async (request) => {
    const { id: reviewId } = uuidParams.parse(request.params);
    const headers = commandHeaders.parse(request.headers);
    const body = decisionBody
      .extend({ comment: z.string().trim().min(1).optional() })
      .parse(request.body);
    const context = await reviewContext(options.database, reviewId);
    const outcome = await executeAuditedCommand(options.database, {
      organizationId: context.organizationId,
      commandType: 'ApproveReview',
      idempotencyKey: headers['idempotency-key'] ?? request.id,
      actorMemberId: headers['x-actor-member-id'] ?? context.accountableHumanId,
      source: headers['x-command-source'] ?? 'human',
      payload: toJson(body),
      entityType: 'review', entityId: reviewId,
      executionId: context.executionId, workItemId: context.workItemId,
      graphVersion: context.graphVersion,
      eventType: 'Review.Approved', category: 'review',
      summary: 'Review approved', importance: 'important',
      mutate: async (tx) => {
        const txDatabase = tx as unknown as Database;
        const txService = new ReviewWorkflowService(
          new PostgresReviewRepository(txDatabase),
          new PostgresExecutionRepository(txDatabase),
          new DatabaseReworkStartGuard(txDatabase),
        );
        const approved = await txService.approve({
          reviewId,
          expectedReviewVersion: body.expectedReviewVersion,
          expectedGateVersion: body.expectedGateVersion,
          occurredAt: body.occurredAt ?? new Date(),
          ...(body.comment ? { comment: body.comment } : {}),
        });
        return { result: toJson(approved), entityVersion: approved.review.version };
      },
    });
    return outcome.result;
  });

  server.post('/api/reviews/:id/reject', async (request) => {
    const { id: reviewId } = uuidParams.parse(request.params);
    const headers = commandHeaders.parse(request.headers);
    const body = decisionBody
      .extend({ reason: z.string().trim().min(1) })
      .parse(request.body);
    const context = await reviewContext(options.database, reviewId);
    const reworkRequestId = randomUUID();
    const outcome = await executeAuditedCommand(options.database, {
      organizationId: context.organizationId,
      commandType: 'RejectReview',
      idempotencyKey: headers['idempotency-key'] ?? request.id,
      actorMemberId: headers['x-actor-member-id'] ?? context.accountableHumanId,
      source: headers['x-command-source'] ?? 'human',
      payload: toJson(body),
      entityType: 'review', entityId: reviewId,
      executionId: context.executionId, workItemId: context.workItemId,
      graphVersion: context.graphVersion,
      eventType: 'Review.Rejected', category: 'review',
      summary: 'Review rejected and rework requested', importance: 'important',
      mutate: async (tx) => {
        const txDatabase = tx as unknown as Database;
        const txService = new ReviewWorkflowService(
          new PostgresReviewRepository(txDatabase),
          new PostgresExecutionRepository(txDatabase),
          new DatabaseReworkStartGuard(txDatabase),
        );
        const rejected = await txService.reject({
          reviewId,
          expectedReviewVersion: body.expectedReviewVersion,
          expectedGateVersion: body.expectedGateVersion,
          occurredAt: body.occurredAt ?? new Date(),
          reason: body.reason,
          reworkRequestId,
        });
        return { result: toJson(rejected), entityVersion: rejected.review.version };
      },
    });
    return outcome.result;
  });

  server.post('/api/rework-requests/:id/start', async (request, reply) => {
    const { id: reworkRequestId } = uuidParams.parse(request.params);
    const headers = commandHeaders.parse(request.headers);
    const body = z
      .object({
        expectedVersion: z.number().int().positive(),
        mode: z.enum(['self', 'external_manual']),
        executorMemberId: z.string().uuid(),
        startedAt: timestamp.optional(),
      })
      .parse(request.body);
    const context = await reworkContext(options.database, reworkRequestId);
    const executionId = randomUUID();
    const outcome = await executeAuditedCommand(options.database, {
      organizationId: context.organizationId,
      commandType: 'StartRework',
      idempotencyKey: headers['idempotency-key'] ?? request.id,
      actorMemberId: headers['x-actor-member-id'] ?? body.executorMemberId,
      source: headers['x-command-source'] ?? 'human',
      payload: toJson(body),
      entityType: 'rework_request', entityId: reworkRequestId,
      executionId, workItemId: context.workItemId, graphVersion: context.graphVersion,
      eventType: 'Rework.Started', category: 'review',
      summary: 'Rework execution started',
      mutate: async (tx) => {
        const txDatabase = tx as unknown as Database;
        const txService = new ReviewWorkflowService(
          new PostgresReviewRepository(txDatabase),
          new PostgresExecutionRepository(txDatabase),
          new DatabaseReworkStartGuard(txDatabase),
        );
        const started = await txService.startRework({
          reworkRequestId,
          expectedVersion: body.expectedVersion,
          executionId,
          mode: body.mode,
          executorMemberId: body.executorMemberId,
          startedAt: body.startedAt ?? new Date(),
        });
        return { result: toJson(started), entityVersion: started.rework.version };
      },
    });
    void reply.header('Idempotency-Replayed', String(outcome.replayed));
    void reply.code(201);
    return outcome.result;
  });

  done();
};
