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

describe('Bug WorkItem, QA return, and Release Gate API', () => {
  it('blocks release until a reviewed fix passes QA regression', async () => {
    const suffix = randomUUID();
    const [organization] = await connection.database
      .insert(schema.organizations)
      .values({ name: 'QA Org', slug: `qa-${suffix}` })
      .returning();
    if (!organization) throw new Error('organization was not created');
    const [owner, reviewer, qa] = await connection.database
      .insert(schema.members)
      .values([
        { organizationId: organization.id, memberType: 'human', name: 'Owner' },
        { organizationId: organization.id, memberType: 'human', name: 'Reviewer' },
        { organizationId: organization.id, memberType: 'human', name: 'QA' },
      ])
      .returning();
    if (!owner || !reviewer || !qa) throw new Error('members were not created');
    const [project] = await connection.database
      .insert(schema.projects)
      .values({
        organizationId: organization.id,
        name: 'QA Project',
        slug: `qa-${suffix}`,
        accountableHumanId: owner.id,
        operationalOwnerId: owner.id,
      })
      .returning();
    if (!project) throw new Error('project was not created');
    const [requirement] = await connection.database
      .insert(schema.requirements)
      .values({
        projectId: project.id,
        goal: 'Release only after regression passes',
        acceptanceCriteria: ['Blocking Bugs close after QA passes'],
        accountableHumanId: owner.id,
        operationalOwnerId: owner.id,
        assigneeMemberId: owner.id,
      })
      .returning();
    if (!requirement) throw new Error('requirement was not created');

    const graphCreation = await server.inject({
      method: 'POST',
      url: `/api/requirements/${requirement.id}/work-graph`,
      payload: { nodes: [{ key: 'fix', title: 'Fix the defect' }], edges: [] },
    });
    expect(graphCreation.statusCode).toBe(201);
    const graphResponse = await server.inject({
      method: 'GET',
      url: `/api/requirements/${requirement.id}/work-graph`,
    });
    const graph = graphResponse.json<{
      graphVersion: number;
      nodes: Array<{ workItemId: string }>;
    }>();
    const workItemId = graph.nodes[0]!.workItemId;

    const executionResponse = await server.inject({
      method: 'POST',
      url: `/api/work-items/${workItemId}/executions`,
      payload: {
        graphVersion: graph.graphVersion,
        mode: 'self',
        executorMemberId: owner.id,
        startedAt: '2026-08-11T06:00:00.000Z',
      },
    });
    expect(executionResponse.statusCode).toBe(201);
    const execution = executionResponse.json<{ id: string }>();
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/work-items/${workItemId}/transition`,
          headers: { 'if-match': '1' },
          payload: { toStatus: 'in_progress', expectedGraphVersion: graph.graphVersion },
        })
      ).statusCode,
    ).toBe(200);
    const finishResponse = await server.inject({
      method: 'POST',
      url: `/api/executions/${execution.id}/finish`,
      payload: {
        expectedVersion: 1,
        outcome: 'completed',
        endedAt: '2026-08-11T06:01:00.000Z',
        result: {
          summary: 'Implemented the Bug fix',
          verificationSource: 'human_verified',
        },
      },
    });
    expect(finishResponse.statusCode).toBe(200);
    const result = finishResponse.json<{ result: { id: string } }>().result;
    const reviewResponse = await server.inject({
      method: 'POST',
      url: `/api/executions/${execution.id}/reviews`,
      payload: {
        reviewerMemberId: reviewer.id,
        requestedAt: '2026-08-11T06:02:00.000Z',
      },
    });
    expect(reviewResponse.statusCode).toBe(201);
    const review = reviewResponse.json<{
      review: { id: string; version: number };
      gate: { id: string; version: number };
    }>();
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/reviews/${review.review.id}/approve`,
          payload: {
            expectedReviewVersion: review.review.version,
            expectedGateVersion: review.gate.version,
            occurredAt: '2026-08-11T06:03:00.000Z',
          },
        })
      ).statusCode,
    ).toBe(200);

    const createBugResponse = await server.inject({
      method: 'POST',
      url: `/api/requirements/${requirement.id}/bugs`,
      payload: {
        graphVersion: graph.graphVersion,
        title: 'Release drops audit history',
        description: 'QA reproduced missing audit history on the release path.',
        discoveredIn: 'qa',
        severity: 'critical',
        blocking: true,
        reporterMemberId: qa.id,
        createdAt: '2026-08-11T06:04:00.000Z',
      },
    });
    expect(createBugResponse.statusCode).toBe(201);
    const bug = createBugResponse.json<{ id: string; version: number }>();
    const [blockedRequirement] = await connection.database
      .select({ status: schema.requirements.status })
      .from(schema.requirements)
      .where(eq(schema.requirements.id, requirement.id));
    expect(blockedRequirement?.status).toBe('blocked');

    const blockedGate = await server.inject({
      method: 'GET',
      url: `/api/requirements/${requirement.id}/release-gate`,
    });
    expect(blockedGate.json()).toEqual({ allowed: false, blockingBugIds: [bug.id] });
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/requirements/${requirement.id}/release-gate`,
        })
      ).statusCode,
    ).toBe(409);

    const startedFix = await server.inject({
      method: 'POST',
      url: `/api/bugs/${bug.id}/start-fix`,
      payload: {
        expectedBugVersion: bug.version,
        occurredAt: '2026-08-11T06:05:00.000Z',
      },
    });
    expect(startedFix.statusCode).toBe(200);
    const startedBug = startedFix.json<{ version: number }>();
    const submitFix = await server.inject({
      method: 'POST',
      url: `/api/bugs/${bug.id}/submit-fix`,
      payload: {
        expectedBugVersion: startedBug.version,
        executionId: execution.id,
        resultId: result.id,
        reviewId: review.review.id,
        passedGateId: review.gate.id,
        qaMemberId: qa.id,
        occurredAt: '2026-08-11T06:06:00.000Z',
      },
    });
    expect(submitFix.statusCode).toBe(201);
    const submitted = submitFix.json<{
      bug: { status: string; version: number };
      regression: { id: string; status: string; version: number };
    }>();
    expect(submitted.bug.status).toBe('awaiting_qa');
    expect(submitted.regression.status).toBe('pending');

    const regression = await server.inject({
      method: 'POST',
      url: `/api/qa-regressions/${submitted.regression.id}/complete`,
      payload: {
        expectedRegressionVersion: submitted.regression.version,
        expectedBugVersion: submitted.bug.version,
        outcome: 'passed',
        notes: 'Release audit history is preserved.',
        occurredAt: '2026-08-11T06:07:00.000Z',
      },
    });
    expect(regression.statusCode).toBe(200);
    expect(regression.json()).toMatchObject({
      bug: { status: 'closed', blocking: false },
      regression: { status: 'passed' },
    });
    expect(
      (
        await server.inject({
          method: 'POST',
          url: `/api/work-items/${workItemId}/transition`,
          headers: { 'if-match': '2' },
          payload: { toStatus: 'completed', expectedGraphVersion: graph.graphVersion },
        })
      ).statusCode,
    ).toBe(200);
    const [completedRequirement] = await connection.database
      .select({ status: schema.requirements.status })
      .from(schema.requirements)
      .where(eq(schema.requirements.id, requirement.id));
    expect(completedRequirement?.status).toBe('completed');
    const openGate = await server.inject({
      method: 'POST',
      url: `/api/requirements/${requirement.id}/release-gate`,
    });
    expect(openGate.statusCode).toBe(200);
    expect(openGate.json()).toEqual({ requirementId: requirement.id, releasable: true });

    const comment = await server.inject({
      method: 'POST',
      url: `/api/v1/work-items/${workItemId}/comments`,
      headers: { 'if-match': '3', 'idempotency-key': `comment-${suffix}` },
      payload: { body: 'Release evidence reviewed.' },
    });
    expect(comment.statusCode).toBe(200);

    const authorization = await server.inject({
      method: 'POST',
      url: `/api/v1/releases/${requirement.id}/gate`,
      headers: { 'idempotency-key': `release-${suffix}` },
      payload: { decision: 'approve', note: 'All required evidence accepted.' },
    });
    expect(authorization.statusCode).toBe(200);
    expect(authorization.json()).toMatchObject({
      requirementId: requirement.id,
      status: 'approved',
    });

    const audit = await server.inject({
      method: 'GET',
      url: `/api/v1/domain-events?organizationId=${organization.id}`,
    });
    expect(
      audit.json<{ events: Array<{ eventType: string }> }>().events.map((event) => event.eventType),
    ).toEqual(expect.arrayContaining(['WorkItem.CommentAdded', 'Release.Authorized']));
  });
});
