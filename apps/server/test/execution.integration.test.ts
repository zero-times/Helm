import { randomUUID } from 'node:crypto';

import { createDatabase, eq, migrateDatabase, schema } from '@helm/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://helm:helm@localhost:5432/helm';
const connection = createDatabase(databaseUrl, { maxConnections: 2 });
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

describe('manual execution API', () => {
  it('guards real work items and persists immutable completed, failed, and cancelled history', async () => {
    const suffix = randomUUID();
    const [organization] = await connection.database
      .insert(schema.organizations)
      .values({ name: 'Execution Org', slug: `execution-${suffix}` })
      .returning();
    if (!organization) throw new Error('organization was not created');
    const [human] = await connection.database
      .insert(schema.members)
      .values({
        organizationId: organization.id,
        memberType: 'human',
        name: 'Manual Executor',
      })
      .returning();
    if (!human) throw new Error('human was not created');
    const [project] = await connection.database
      .insert(schema.projects)
      .values({
        organizationId: organization.id,
        name: 'Execution Project',
        slug: `execution-${suffix}`,
        accountableHumanId: human.id,
        operationalOwnerId: human.id,
      })
      .returning();
    if (!project) throw new Error('project was not created');
    const [requirement] = await connection.database
      .insert(schema.requirements)
      .values({
        projectId: project.id,
        goal: 'Record immutable manual execution history',
        acceptanceCriteria: ['All terminal outcomes retain results'],
        accountableHumanId: human.id,
        operationalOwnerId: human.id,
        assigneeMemberId: human.id,
      })
      .returning();
    if (!requirement) throw new Error('requirement was not created');

    const graphResponse = await server.inject({
      method: 'POST',
      url: `/api/requirements/${requirement.id}/work-graph`,
      payload: {
        nodes: [
          { key: 'execute', title: 'Execute manually' },
          { key: 'verify', title: 'Verify execution' },
        ],
        edges: [{ sourceKey: 'execute', targetKey: 'verify' }],
      },
    });
    expect(graphResponse.statusCode).toBe(201);
    const graph = await server.inject({
      method: 'GET',
      url: `/api/requirements/${requirement.id}/work-graph`,
    });
    const graphBody = graph.json<{
      graphVersion: number;
      nodes: Array<{ key: string; workItemId: string }>;
    }>();
    const readyWorkItemId = graphBody.nodes.find(
      (node) => node.key === 'execute',
    )?.workItemId;
    const pendingWorkItemId = graphBody.nodes.find(
      (node) => node.key === 'verify',
    )?.workItemId;
    if (!readyWorkItemId || !pendingWorkItemId) throw new Error('work items missing');

    await expect(
      connection.database.insert(schema.manualExecutions).values({
        id: randomUUID(),
        workItemId: pendingWorkItemId,
        graphVersion: graphBody.graphVersion,
        mode: 'self',
        executorMemberId: human.id,
        status: 'running',
        startedAt: new Date(),
        updatedAt: new Date(),
        version: 1,
      }),
    ).rejects.toThrow();

    const pendingStart = await server.inject({
      method: 'POST',
      url: `/api/work-items/${pendingWorkItemId}/executions`,
      payload: {
        graphVersion: graphBody.graphVersion,
        mode: 'self',
        executorMemberId: human.id,
      },
    });
    expect(pendingStart.statusCode).toBe(409);

    const staleStart = await server.inject({
      method: 'POST',
      url: `/api/work-items/${readyWorkItemId}/executions`,
      payload: {
        graphVersion: graphBody.graphVersion + 1,
        mode: 'self',
        executorMemberId: human.id,
      },
    });
    expect(staleStart.statusCode).toBe(409);

    const started = await server.inject({
      method: 'POST',
      url: `/api/work-items/${readyWorkItemId}/executions`,
      payload: {
        graphVersion: graphBody.graphVersion,
        mode: 'external_manual',
        executorMemberId: human.id,
        startedAt: '2026-08-11T01:00:00.000Z',
      },
    });
    expect(started.statusCode).toBe(201);
    const execution = started.json<{ id: string; version: number; status: string }>();
    expect(execution).toMatchObject({ version: 1, status: 'running' });

    const waiting = await server.inject({
      method: 'POST',
      url: `/api/executions/${execution.id}/wait-for-input`,
      payload: {
        expectedVersion: 1,
        reason: 'Need deployment approval',
        occurredAt: '2026-08-11T01:01:00.000Z',
      },
    });
    expect(waiting.json()).toMatchObject({
      status: 'waiting_for_input',
      version: 2,
    });

    const resumed = await server.inject({
      method: 'POST',
      url: `/api/executions/${execution.id}/resume`,
      payload: {
        expectedVersion: 2,
        occurredAt: '2026-08-11T01:02:00.000Z',
      },
    });
    expect(resumed.json()).toMatchObject({ status: 'running', version: 3 });

    const artifactId = randomUUID();
    const testId = randomUUID();
    const completed = await server.inject({
      method: 'POST',
      url: `/api/executions/${execution.id}/finish`,
      payload: {
        expectedVersion: 3,
        outcome: 'completed',
        endedAt: '2026-08-11T01:03:00.000Z',
        result: {
          summary: 'Deployment completed and verified',
          changedFiles: ['apps/server/src/app.ts'],
          artifacts: [
            {
              id: artifactId,
              kind: 'log',
              name: 'deployment.log',
              uri: 'artifact://deployment.log',
              metadata: { environment: 'test' },
            },
          ],
          tests: [
            {
              id: testId,
              name: 'smoke test',
              status: 'passed',
              artifactIds: [artifactId],
            },
          ],
          knownIssues: [
            {
              id: randomUUID(),
              title: 'Manual follow-up',
              description: 'Observe metrics for one hour',
              severity: 'low',
              blocking: false,
            },
          ],
          needsHumanDecision: true,
          humanDecision: {
            question: 'Promote to production?',
            context: 'All smoke tests passed',
            options: ['approve', 'hold'],
          },
          verificationSource: 'human_verified',
          durationMs: 180000,
        },
      },
    });
    expect(completed.statusCode).toBe(200);
    const completedBody = completed.json<{ result: { id: string } }>();

    const persisted = await server.inject({
      method: 'GET',
      url: `/api/executions/${execution.id}/result`,
    });
    expect(persisted.json()).toMatchObject({
      id: completedBody.result.id,
      outcome: 'completed',
      artifacts: [{ id: artifactId }],
      tests: [{ id: testId, artifactIds: [artifactId] }],
      needsHumanDecision: true,
    });

    await expect(
      connection.database
        .update(schema.executionResults)
        .set({ summary: 'attempted overwrite' })
        .where(eq(schema.executionResults.id, completedBody.result.id)),
    ).rejects.toThrow();

    for (const [outcome, endReason] of [
      ['failed', 'Manual validation failed'],
      ['cancelled', 'Operator canceled the attempt'],
    ] as const) {
      const retry = await server.inject({
        method: 'POST',
        url: `/api/work-items/${readyWorkItemId}/executions`,
        payload: {
          graphVersion: graphBody.graphVersion,
          mode: 'self',
          executorMemberId: human.id,
        },
      });
      expect(retry.statusCode).toBe(201);
      const retryExecution = retry.json<{ id: string }>();
      const finished = await server.inject({
        method: 'POST',
        url: `/api/executions/${retryExecution.id}/finish`,
        payload: {
          expectedVersion: 1,
          outcome,
          endReason,
          result: {
            summary: endReason,
            knownIssues: [
              {
                id: randomUUID(),
                title: `${outcome} attempt`,
                description: endReason,
                severity: 'high',
                blocking: true,
              },
            ],
            verificationSource: 'human_verified',
          },
        },
      });
      expect(finished.statusCode).toBe(200);
      expect(finished.json()).toMatchObject({
        execution: { status: outcome, endReason },
        result: { outcome, summary: endReason },
      });
    }

    const history = await server.inject({
      method: 'GET',
      url: `/api/work-items/${readyWorkItemId}/executions`,
    });
    const historyBody = history.json<{
      executions: Array<{ status: string }>;
      results: Array<{ outcome: string }>;
    }>();
    expect(historyBody.executions.map((item) => item.status)).toEqual([
      'completed',
      'failed',
      'cancelled',
    ]);
    expect(historyBody.results.map((item) => item.outcome)).toEqual([
      'completed',
      'failed',
      'cancelled',
    ]);

    const auditResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/domain-events?organizationId=${organization.id}&workItemId=${readyWorkItemId}`,
    });
    expect(auditResponse.statusCode).toBe(200);
    const eventTypes = auditResponse
      .json<{ events: Array<{ eventType: string }> }>()
      .events.map((event) => event.eventType);
    expect(eventTypes).toContain('Execution.Started');
    expect(eventTypes).toContain('Execution.WaitingForInput');
    expect(eventTypes).toContain('Execution.Resumed');
    expect(eventTypes).toContain('Execution.Finished');
  });
});
