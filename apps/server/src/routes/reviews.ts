import { randomUUID } from 'node:crypto';

import { ConflictError, NotFoundError } from '@helm/core-domain';
import { and, eq, schema, type Database } from '@helm/database';
import type { ManualExecutionStartGuard } from '@helm/execution';
import { PostgresExecutionRepository } from '@helm/execution/postgres';
import { ReviewWorkflowService } from '@helm/review';
import { PostgresReviewRepository } from '@helm/review/postgres';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

const uuidParams = z.object({ id: z.string().uuid() });
const timestamp = z.string().datetime({ offset: true });
const decisionBody = z.object({
  expectedReviewVersion: z.number().int().positive(),
  expectedGateVersion: z.number().int().positive(),
  occurredAt: timestamp.optional(),
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

export const reviewRoutes: FastifyPluginCallback<ReviewRoutesOptions> = (
  server,
  options,
  done,
) => {
  const repository = new PostgresReviewRepository(options.database);
  const service = new ReviewWorkflowService(
    repository,
    new PostgresExecutionRepository(options.database),
    new DatabaseReworkStartGuard(options.database),
  );

  server.post('/api/executions/:id/reviews', async (request, reply) => {
    const { id: executionId } = uuidParams.parse(request.params);
    const body = z
      .object({
        reviewerMemberId: z.string().uuid(),
        requestedAt: timestamp.optional(),
      })
      .parse(request.body);
    const created = await service.requestReview({
      reviewId: randomUUID(),
      gateId: randomUUID(),
      executionId,
      reviewerMemberId: body.reviewerMemberId,
      requestedAt: body.requestedAt ?? new Date(),
    });
    void reply.code(201);
    return created;
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
    const body = decisionBody
      .extend({ comment: z.string().trim().min(1).optional() })
      .parse(request.body);
    return service.approve({
      reviewId,
      expectedReviewVersion: body.expectedReviewVersion,
      expectedGateVersion: body.expectedGateVersion,
      occurredAt: body.occurredAt ?? new Date(),
      ...(body.comment ? { comment: body.comment } : {}),
    });
  });

  server.post('/api/reviews/:id/reject', async (request) => {
    const { id: reviewId } = uuidParams.parse(request.params);
    const body = decisionBody
      .extend({ reason: z.string().trim().min(1) })
      .parse(request.body);
    return service.reject({
      reviewId,
      expectedReviewVersion: body.expectedReviewVersion,
      expectedGateVersion: body.expectedGateVersion,
      occurredAt: body.occurredAt ?? new Date(),
      reason: body.reason,
      reworkRequestId: randomUUID(),
    });
  });

  server.post('/api/rework-requests/:id/start', async (request, reply) => {
    const { id: reworkRequestId } = uuidParams.parse(request.params);
    const body = z
      .object({
        expectedVersion: z.number().int().positive(),
        mode: z.enum(['self', 'external_manual']),
        executorMemberId: z.string().uuid(),
        startedAt: timestamp.optional(),
      })
      .parse(request.body);
    const started = await service.startRework({
      reworkRequestId,
      expectedVersion: body.expectedVersion,
      executionId: randomUUID(),
      mode: body.mode,
      executorMemberId: body.executorMemberId,
      startedAt: body.startedAt ?? new Date(),
    });
    void reply.code(201);
    return started;
  });

  done();
};
