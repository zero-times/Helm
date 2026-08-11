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
let organizationId: string | undefined;
let projectId: string | undefined;

beforeAll(async () => {
  await migrateDatabase(connection.database);
  await server.ready();
});

afterAll(async () => {
  if (organizationId) {
    if (projectId) {
      await connection.database
        .delete(schema.requirements)
        .where(eq(schema.requirements.projectId, projectId));
    }
    await connection.database
      .delete(schema.projects)
      .where(eq(schema.projects.organizationId, organizationId));
    await connection.database
      .delete(schema.members)
      .where(eq(schema.members.organizationId, organizationId));
    await connection.database
      .delete(schema.organizations)
      .where(eq(schema.organizations.id, organizationId));
  }
  await server.close();
  await connection.close();
});

describe('minimal work graph', () => {
  it('enforces dependencies, advances downstream, and derives requirement state', async () => {
    const suffix = randomUUID();
    const [organization] = await connection.database
      .insert(schema.organizations)
      .values({ name: 'Graph Org', slug: `graph-${suffix}` })
      .returning();
    if (!organization) throw new Error('organization was not created');
    organizationId = organization.id;
    const [human] = await connection.database
      .insert(schema.members)
      .values({ organizationId, memberType: 'human', name: 'Owner' })
      .returning();
    if (!human) throw new Error('human was not created');
    const [project] = await connection.database
      .insert(schema.projects)
      .values({
        organizationId,
        name: 'Graph Project',
        slug: `graph-${suffix}`,
        accountableHumanId: human.id,
        operationalOwnerId: human.id,
      })
      .returning();
    if (!project) throw new Error('project was not created');
    projectId = project.id;
    const [requirement] = await connection.database
      .insert(schema.requirements)
      .values({
        projectId: project.id,
        goal: 'Execute a dependency graph',
        acceptanceCriteria: ['Downstream waits'],
        accountableHumanId: human.id,
        operationalOwnerId: human.id,
        assigneeMemberId: human.id,
      })
      .returning();
    if (!requirement) throw new Error('requirement was not created');

    const created = await server.inject({
      method: 'POST',
      url: `/api/requirements/${requirement.id}/work-graph`,
      headers: { 'idempotency-key': `create-graph-${suffix}` },
      payload: {
        nodes: [
          { key: 'implement', title: 'Implement', isRequired: true },
          { key: 'verify', title: 'Verify', isRequired: true },
        ],
        edges: [{ sourceKey: 'implement', targetKey: 'verify' }],
      },
    });
    expect(created.statusCode, created.body).toBe(201);

    const replayed = await server.inject({
      method: 'POST',
      url: `/api/requirements/${requirement.id}/work-graph`,
      headers: { 'idempotency-key': `create-graph-${suffix}` },
      payload: {
        nodes: [
          { key: 'implement', title: 'Implement', isRequired: true },
          { key: 'verify', title: 'Verify', isRequired: true },
        ],
        edges: [{ sourceKey: 'implement', targetKey: 'verify' }],
      },
    });
    expect(replayed.statusCode).toBe(201);
    expect(replayed.headers['idempotency-replayed']).toBe('true');
    expect(replayed.json()).toEqual(created.json());

    const graphResponse = await server.inject({
      method: 'GET',
      url: `/api/requirements/${requirement.id}/work-graph`,
    });
    expect(graphResponse.statusCode).toBe(200);
    const graph = graphResponse.json<{
      graphVersion: number;
      nodes: Array<{
        key: string;
        workItemId: string;
        status: string;
        entityVersion: number;
      }>;
    }>();
    const implement = graph.nodes.find((node) => node.key === 'implement');
    const verify = graph.nodes.find((node) => node.key === 'verify');
    expect(implement?.status).toBe('ready');
    expect(verify?.status).toBe('pending');

    const premature = await server.inject({
      method: 'POST',
      url: `/api/work-items/${verify!.workItemId}/transition`,
      headers: {
        'idempotency-key': `premature-${suffix}`,
        'if-match': '1',
      },
      payload: { toStatus: 'ready', expectedGraphVersion: graph.graphVersion },
    });
    expect(premature.statusCode).toBe(409);
    expect(premature.json()).toMatchObject({ error: 'DEPENDENCY_NOT_SATISFIED' });

    let implementVersion = implement!.entityVersion;
    for (const toStatus of ['in_progress', 'completed']) {
      const response = await server.inject({
        method: 'POST',
        url: `/api/work-items/${implement!.workItemId}/transition`,
        headers: {
          'idempotency-key': `implement-${toStatus}-${suffix}`,
          'if-match': String(implementVersion),
        },
        payload: { toStatus, expectedGraphVersion: graph.graphVersion },
      });
      expect(response.statusCode).toBe(200);
      implementVersion += 1;
    }

    const stale = await server.inject({
      method: 'POST',
      url: `/api/work-items/${implement!.workItemId}/transition`,
      headers: {
        'idempotency-key': `stale-${suffix}`,
        'if-match': '1',
      },
      payload: { toStatus: 'failed', expectedGraphVersion: graph.graphVersion },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: 'OPTIMISTIC_CONCURRENCY_CONFLICT' });

    const advanced = await server.inject({
      method: 'GET',
      url: `/api/requirements/${requirement.id}/work-graph`,
    });
    const advancedGraph = advanced.json<{ nodes: Array<{ key: string; status: string }> }>();
    expect(advancedGraph.nodes.find((node) => node.key === 'verify')?.status).toBe('ready');

    const illegal = await server.inject({
      method: 'POST',
      url: `/api/work-items/${implement!.workItemId}/transition`,
      headers: {
        'idempotency-key': `illegal-${suffix}`,
        'if-match': String(implementVersion),
      },
      payload: { toStatus: 'in_progress', expectedGraphVersion: graph.graphVersion },
    });
    expect(illegal.statusCode).toBe(409);
    expect(illegal.json()).toMatchObject({ error: 'INVALID_STATE_TRANSITION' });

    await server.inject({
      method: 'POST',
      url: `/api/work-items/${verify!.workItemId}/transition`,
      headers: {
        'idempotency-key': `verify-start-${suffix}`,
        'if-match': '1',
      },
      payload: { toStatus: 'in_progress', expectedGraphVersion: graph.graphVersion },
    });
    await server.inject({
      method: 'POST',
      url: `/api/work-items/${verify!.workItemId}/transition`,
      headers: {
        'idempotency-key': `verify-complete-${suffix}`,
        'if-match': '2',
      },
      payload: { toStatus: 'completed', expectedGraphVersion: graph.graphVersion },
    });
    const [completedRequirement] = await connection.database
      .select({ status: schema.requirements.status })
      .from(schema.requirements)
      .where(eq(schema.requirements.id, requirement.id));
    expect(completedRequirement?.status).toBe('completed');

    const timelineResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/timeline?organizationId=${organizationId}&limit=20`,
    });
    expect(timelineResponse.statusCode).toBe(200);
    const timeline = timelineResponse.json<{
      events: Array<{ eventType?: string; category: string; entityVersion: number }>;
      nextPosition: number;
    }>();
    expect(timeline.events).toHaveLength(5);
    expect(timeline.events.every((event) => event.category === 'state_change')).toBe(true);
    expect(timeline.nextPosition).toBeGreaterThan(0);

    await expect(
      connection.database
        .update(schema.requirements)
        .set({ status: 'blocked' })
        .where(eq(schema.requirements.id, requirement.id)),
    ).rejects.toThrow();
  });
});
