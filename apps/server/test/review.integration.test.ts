import { randomUUID } from 'node:crypto';

import { createDatabase, eq, migrateDatabase, schema } from '@helm/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://helm:helm@localhost:5432/helm';
const connection = createDatabase(databaseUrl, { maxConnections: 3 });
const server = buildApp({
  config: { APP_VERSION: 'test', WEB_ORIGIN: 'http://localhost:5173' },
  checkDatabase: () => Promise.resolve(),
  database: connection.database,
  logger: false,
});

beforeAll(async () => {
  await migrateDatabase(connection.database);
  await server.ready();
});

afterAll(async () => {
  await server.close();
  await connection.close();
});

describe('Review, Human Gate, and Rework API', () => {
  it('blocks completion until approval and preserves the rejected execution during rework', async () => {
    const suffix = randomUUID();
    const [organization] = await connection.database
      .insert(schema.organizations)
      .values({ name: 'Review Org', slug: `review-${suffix}` })
      .returning();
    if (!organization) throw new Error('organization was not created');
    const [owner, reviewer] = await connection.database
      .insert(schema.members)
      .values([
        { organizationId: organization.id, memberType: 'human', name: 'Owner' },
        { organizationId: organization.id, memberType: 'human', name: 'Reviewer' },
      ])
      .returning();
    if (!owner || !reviewer) throw new Error('members were not created');
    const [project] = await connection.database
      .insert(schema.projects)
      .values({
        organizationId: organization.id,
        name: 'Review Project',
        slug: `review-${suffix}`,
        accountableHumanId: owner.id,
        operationalOwnerId: owner.id,
      })
      .returning();
    if (!project) throw new Error('project was not created');
    const [requirement] = await connection.database
      .insert(schema.requirements)
      .values({
        projectId: project.id,
        goal: 'Require approval before downstream work',
        acceptanceCriteria: ['Reject creates an immutable rework path'],
        accountableHumanId: owner.id,
        operationalOwnerId: owner.id,
        assigneeMemberId: owner.id,
      })
      .returning();
    if (!requirement) throw new Error('requirement was not created');

    const graphCreation = await server.inject({
      method: 'POST',
      url: `/api/requirements/${requirement.id}/work-graph`,
      payload: {
        nodes: [
          { key: 'implement', title: 'Implement' },
          { key: 'release', title: 'Release' },
        ],
        edges: [{ sourceKey: 'implement', targetKey: 'release' }],
      },
    });
    expect(graphCreation.statusCode).toBe(201);
    const graphResponse = await server.inject({
      method: 'GET',
      url: `/api/requirements/${requirement.id}/work-graph`,
    });
    const graph = graphResponse.json<{
      graphVersion: number;
      nodes: Array<{ key: string; workItemId: string; status: string }>;
    }>();
    const implementationId = graph.nodes.find((node) => node.key === 'implement')!.workItemId;
    const releaseId = graph.nodes.find((node) => node.key === 'release')!.workItemId;

    const firstStart = await server.inject({
      method: 'POST',
      url: `/api/work-items/${implementationId}/executions`,
      payload: {
        graphVersion: graph.graphVersion,
        mode: 'self',
        executorMemberId: owner.id,
        startedAt: '2026-08-11T05:00:00.000Z',
      },
    });
    expect(firstStart.statusCode).toBe(201);
    const firstExecution = firstStart.json<{ id: string }>();
    const startWorkItem = await server.inject({
      method: 'POST',
      url: `/api/work-items/${implementationId}/transition`,
      payload: { toStatus: 'in_progress', expectedGraphVersion: graph.graphVersion },
    });
    expect(startWorkItem.statusCode).toBe(200);
    const firstFinish = await server.inject({
      method: 'POST',
      url: `/api/executions/${firstExecution.id}/finish`,
      payload: {
        expectedVersion: 1,
        outcome: 'completed',
        endedAt: '2026-08-11T05:01:00.000Z',
        result: {
          summary: 'First implementation',
          verificationSource: 'human_verified',
        },
      },
    });
    expect(firstFinish.statusCode).toBe(200);
    const firstResult = firstFinish.json<{ result: { id: string } }>().result;

    const firstReviewResponse = await server.inject({
      method: 'POST',
      url: `/api/executions/${firstExecution.id}/reviews`,
      payload: {
        reviewerMemberId: reviewer.id,
        requestedAt: '2026-08-11T05:02:00.000Z',
      },
    });
    expect(firstReviewResponse.statusCode).toBe(201);
    const firstReview = firstReviewResponse.json<{
      review: { id: string; version: number };
      gate: { version: number };
    }>();

    const pendingCompletion = await server.inject({
      method: 'POST',
      url: `/api/work-items/${implementationId}/transition`,
      payload: { toStatus: 'completed', expectedGraphVersion: graph.graphVersion },
    });
    expect(pendingCompletion.statusCode).toBe(409);
    expect(pendingCompletion.json()).toMatchObject({ error: 'GateBlockedError' });
    await expect(
      connection.database
        .update(schema.workItems)
        .set({ status: 'completed' })
        .where(eq(schema.workItems.id, implementationId)),
    ).rejects.toThrow();
    const [stillInProgress] = await connection.database
      .select({ status: schema.workItems.status })
      .from(schema.workItems)
      .where(eq(schema.workItems.id, implementationId));
    expect(stillInProgress?.status).toBe('in_progress');

    const rejection = await server.inject({
      method: 'POST',
      url: `/api/reviews/${firstReview.review.id}/reject`,
      payload: {
        expectedReviewVersion: firstReview.review.version,
        expectedGateVersion: firstReview.gate.version,
        occurredAt: '2026-08-11T05:03:00.000Z',
        reason: 'Add the missing regression evidence',
      },
    });
    expect(rejection.statusCode).toBe(200);
    const rejected = rejection.json<{
      rework: { id: string; version: number };
    }>();

    const rejectedCompletion = await server.inject({
      method: 'POST',
      url: `/api/work-items/${implementationId}/transition`,
      payload: { toStatus: 'completed', expectedGraphVersion: graph.graphVersion },
    });
    expect(rejectedCompletion.statusCode).toBe(409);

    const reworkStart = await server.inject({
      method: 'POST',
      url: `/api/rework-requests/${rejected.rework.id}/start`,
      payload: {
        expectedVersion: rejected.rework.version,
        mode: 'self',
        executorMemberId: owner.id,
        startedAt: '2026-08-11T05:04:00.000Z',
      },
    });
    expect(reworkStart.statusCode).toBe(201);
    const rework = reworkStart.json<{
      execution: { id: string; version: number };
    }>();
    expect(rework.execution.id).not.toBe(firstExecution.id);

    const reworkFinish = await server.inject({
      method: 'POST',
      url: `/api/executions/${rework.execution.id}/finish`,
      payload: {
        expectedVersion: rework.execution.version,
        outcome: 'completed',
        endedAt: '2026-08-11T05:05:00.000Z',
        result: {
          summary: 'Reworked implementation with regression evidence',
          tests: [
            {
              id: randomUUID(),
              name: 'regression',
              status: 'passed',
            },
          ],
          verificationSource: 'human_verified',
        },
      },
    });
    expect(reworkFinish.statusCode).toBe(200);

    const secondReviewResponse = await server.inject({
      method: 'POST',
      url: `/api/executions/${rework.execution.id}/reviews`,
      payload: {
        reviewerMemberId: reviewer.id,
        requestedAt: '2026-08-11T05:06:00.000Z',
      },
    });
    expect(secondReviewResponse.statusCode).toBe(201);
    const secondReview = secondReviewResponse.json<{
      review: { id: string; version: number };
      gate: { version: number };
    }>();
    const approval = await server.inject({
      method: 'POST',
      url: `/api/reviews/${secondReview.review.id}/approve`,
      payload: {
        expectedReviewVersion: secondReview.review.version,
        expectedGateVersion: secondReview.gate.version,
        occurredAt: '2026-08-11T05:07:00.000Z',
        comment: 'Regression evidence accepted',
      },
    });
    expect(approval.statusCode).toBe(200);

    const completion = await server.inject({
      method: 'POST',
      url: `/api/work-items/${implementationId}/transition`,
      payload: { toStatus: 'completed', expectedGraphVersion: graph.graphVersion },
    });
    expect(completion.statusCode).toBe(200);

    const advanced = await server.inject({
      method: 'GET',
      url: `/api/requirements/${requirement.id}/work-graph`,
    });
    expect(
      advanced
        .json<{ nodes: Array<{ workItemId: string; status: string }> }>()
        .nodes.find((node) => node.workItemId === releaseId)?.status,
    ).toBe('ready');

    const history = await server.inject({
      method: 'GET',
      url: `/api/work-items/${implementationId}/reviews`,
    });
    expect(history.statusCode).toBe(200);
    expect(history.json<{ reviews: unknown[]; gates: unknown[]; reworks: unknown[] }>()).toMatchObject({
      reviews: [{ status: 'rejected' }, { status: 'approved' }],
      gates: [{ status: 'rework_required' }, { status: 'passed' }],
      reworks: [{ previousResultId: firstResult.id, newExecutionId: rework.execution.id }],
    });

    await expect(
      connection.database
        .update(schema.executionResults)
        .set({ summary: 'overwrite attempt' })
        .where(eq(schema.executionResults.id, firstResult.id)),
    ).rejects.toThrow();
    const [preservedResult] = await connection.database
      .select({ summary: schema.executionResults.summary })
      .from(schema.executionResults)
      .where(eq(schema.executionResults.id, firstResult.id));
    expect(preservedResult?.summary).toBe('First implementation');
    await expect(
      connection.database
        .update(schema.reviews)
        .set({ decisionComment: 'overwrite attempt' })
        .where(eq(schema.reviews.id, firstReview.review.id)),
    ).rejects.toThrow();
    const [preservedReview] = await connection.database
      .select({ decisionComment: schema.reviews.decisionComment })
      .from(schema.reviews)
      .where(eq(schema.reviews.id, firstReview.review.id));
    expect(preservedReview?.decisionComment).toBe('Add the missing regression evidence');
  });
});
