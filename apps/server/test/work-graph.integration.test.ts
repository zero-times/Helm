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
const organizationIds: string[] = [];

beforeAll(async () => {
  await migrateDatabase(connection.database);
  await server.ready();
});

afterAll(async () => {
  // Graph-only orgs carry no immutable Execution or Review facts, so their
  // rows can be removed; Execution/Review/Bug orgs are append-only by design.
  for (const organizationId of organizationIds) {
    const projects = await connection.database
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.organizationId, organizationId));
    for (const project of projects) {
      await connection.database
        .delete(schema.requirements)
        .where(eq(schema.requirements.projectId, project.id));
    }
    await connection.database
      .delete(schema.projects)
      .where(eq(schema.projects.organizationId, organizationId));
    await connection.database
      .delete(schema.roleAssignments)
      .where(eq(schema.roleAssignments.organizationId, organizationId));
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
    organizationIds.push(organization.id);
    const organizationId = organization.id;
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

describe('cancellation propagation', () => {
  it('cancels reachable unfinished hard-dependency descendants and derives the requirement as canceled', async () => {
    const suffix = randomUUID();
    const [organization] = await connection.database
      .insert(schema.organizations)
      .values({ name: 'Cancel Org', slug: `cancel-${suffix}` })
      .returning();
    if (!organization) throw new Error('organization was not created');
    organizationIds.push(organization.id);
    const organizationId = organization.id;
    const [human] = await connection.database
      .insert(schema.members)
      .values({ organizationId, memberType: 'human', name: 'Cancel Owner' })
      .returning();
    if (!human) throw new Error('human was not created');
    const [project] = await connection.database
      .insert(schema.projects)
      .values({
        organizationId,
        name: 'Cancel Project',
        slug: `cancel-${suffix}`,
        accountableHumanId: human.id,
        operationalOwnerId: human.id,
      })
      .returning();
    if (!project) throw new Error('project was not created');
    const [requirement] = await connection.database
      .insert(schema.requirements)
      .values({
        projectId: project.id,
        goal: 'Cancel an obsolete branch',
        acceptanceCriteria: ['Downstream hard dependencies are canceled'],
        accountableHumanId: human.id,
        operationalOwnerId: human.id,
        assigneeMemberId: human.id,
      })
      .returning();
    if (!requirement) throw new Error('requirement was not created');

    const created = await server.inject({
      method: 'POST',
      url: `/api/requirements/${requirement.id}/work-graph`,
      headers: { 'idempotency-key': `create-cancel-graph-${suffix}` },
      payload: {
        nodes: [
          { key: 'plan', title: 'Plan' },
          { key: 'build', title: 'Build' },
          { key: 'release', title: 'Release' },
          { key: 'extra', title: 'Soft Extra', isRequired: false },
        ],
        edges: [
          { sourceKey: 'plan', targetKey: 'build' },
          { sourceKey: 'build', targetKey: 'release' },
          { sourceKey: 'plan', targetKey: 'extra', isHardDependency: false },
        ],
      },
    });
    expect(created.statusCode, created.body).toBe(201);

    const graphResponse = await server.inject({
      method: 'GET',
      url: `/api/requirements/${requirement.id}/work-graph`,
    });
    expect(graphResponse.statusCode).toBe(200);
    const graph = graphResponse.json<{
      graphVersion: number;
      nodes: Array<{ key: string; workItemId: string; entityVersion: number }>;
    }>();
    const plan = graph.nodes.find((node) => node.key === 'plan');
    const build = graph.nodes.find((node) => node.key === 'build');
    const release = graph.nodes.find((node) => node.key === 'release');
    const extra = graph.nodes.find((node) => node.key === 'extra');
    if (!plan || !build || !release || !extra) throw new Error('graph nodes were not created');

    // Root nodes start ready, so cancel the plan from in_progress.
    const inProgress = await server.inject({
      method: 'POST',
      url: `/api/work-items/${plan.workItemId}/transition`,
      headers: {
        'idempotency-key': `plan-in_progress-${suffix}`,
        'if-match': String(plan.entityVersion),
      },
      payload: { toStatus: 'in_progress', expectedGraphVersion: graph.graphVersion },
    });
    expect(inProgress.statusCode, inProgress.body).toBe(200);

    const canceled = await server.inject({
      method: 'POST',
      url: `/api/work-items/${plan.workItemId}/transition`,
      headers: {
        'idempotency-key': `cancel-plan-${suffix}`,
        'if-match': String(plan.entityVersion + 1),
      },
      payload: { toStatus: 'canceled', expectedGraphVersion: graph.graphVersion },
    });
    expect(canceled.statusCode, canceled.body).toBe(200);
    const canceledBody = canceled.json<{
      status: string;
      canceledDescendantWorkItemIds: string[];
    }>();
    expect(canceledBody.status).toBe('canceled');
    expect(canceledBody.canceledDescendantWorkItemIds).toHaveLength(2);
    expect(canceledBody.canceledDescendantWorkItemIds).toEqual(
      expect.arrayContaining([build.workItemId, release.workItemId]),
    );
    expect(canceledBody.canceledDescendantWorkItemIds).not.toContain(extra.workItemId);

    const replayed = await server.inject({
      method: 'POST',
      url: `/api/work-items/${plan.workItemId}/transition`,
      headers: {
        'idempotency-key': `cancel-plan-${suffix}`,
        'if-match': String(plan.entityVersion + 1),
      },
      payload: { toStatus: 'canceled', expectedGraphVersion: graph.graphVersion },
    });
    expect(replayed.statusCode, replayed.body).toBe(200);
    expect(replayed.json()).toEqual(canceledBody);

    for (const descendant of [build, release]) {
      const eventsResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/domain-events?organizationId=${organizationId}&workItemId=${descendant.workItemId}`,
      });
      expect(eventsResponse.statusCode, eventsResponse.body).toBe(200);
      expect(eventsResponse.json<{
        events: Array<{
          eventType: string;
          entityId: string;
          entityVersion: number;
          payload: Record<string, unknown>;
        }>;
      }>().events).toEqual([expect.objectContaining({
        eventType: 'WorkItem.StateChanged',
        entityId: descendant.workItemId,
        entityVersion: descendant.entityVersion + 1,
        payload: {
          toStatus: 'canceled',
          propagatedFromWorkItemId: plan.workItemId,
        },
      })]);

      const timelineResponse = await server.inject({
        method: 'GET',
        url: `/api/v1/timeline?organizationId=${organizationId}&workItemId=${descendant.workItemId}`,
      });
      expect(timelineResponse.statusCode, timelineResponse.body).toBe(200);
      expect(timelineResponse.json<{
        events: Array<{ summary: string; details: Record<string, unknown> }>;
      }>().events).toEqual([expect.objectContaining({
        summary: 'Work item canceled by upstream propagation',
        details: {
          toStatus: 'canceled',
          propagatedFromWorkItemId: plan.workItemId,
        },
      })]);
    }

    const finalGraphResponse = await server.inject({
      method: 'GET',
      url: `/api/requirements/${requirement.id}/work-graph`,
    });
    expect(finalGraphResponse.statusCode).toBe(200);
    const statusByKey = new Map(
      finalGraphResponse
        .json<{ nodes: Array<{ key: string; status: string }> }>()
        .nodes.map((node) => [node.key, node.status]),
    );
    expect(statusByKey.get('plan')).toBe('canceled');
    expect(statusByKey.get('build')).toBe('canceled');
    expect(statusByKey.get('release')).toBe('canceled');
    expect(statusByKey.get('extra')).toBe('ready');

    const requirementResponse = await server.inject({
      method: 'GET',
      url: `/api/requirements/${requirement.id}`,
    });
    expect(requirementResponse.statusCode).toBe(200);
    expect(requirementResponse.json<{ status: string }>().status).toBe('canceled');
  });

  it('skips descendants that are already canceled and does not bump their version', async () => {
    const suffix = randomUUID();
    const [organization] = await connection.database
      .insert(schema.organizations)
      .values({ name: 'Cancel Skip Org', slug: `cancel-skip-${suffix}` })
      .returning();
    if (!organization) throw new Error('organization was not created');
    organizationIds.push(organization.id);
    const organizationId = organization.id;
    const [human] = await connection.database
      .insert(schema.members)
      .values({ organizationId, memberType: 'human', name: 'Cancel Skip Owner' })
      .returning();
    if (!human) throw new Error('human was not created');
    const [project] = await connection.database
      .insert(schema.projects)
      .values({
        organizationId,
        name: 'Cancel Skip Project',
        slug: `cancel-skip-${suffix}`,
        accountableHumanId: human.id,
        operationalOwnerId: human.id,
      })
      .returning();
    if (!project) throw new Error('project was not created');
    const [requirement] = await connection.database
      .insert(schema.requirements)
      .values({
        projectId: project.id,
        goal: 'Cancel a partially canceled graph',
        acceptanceCriteria: ['Already canceled descendants stay untouched'],
        accountableHumanId: human.id,
        operationalOwnerId: human.id,
        assigneeMemberId: human.id,
      })
      .returning();
    if (!requirement) throw new Error('requirement was not created');

    const created = await server.inject({
      method: 'POST',
      url: `/api/requirements/${requirement.id}/work-graph`,
      headers: { 'idempotency-key': `create-cancel-skip-graph-${suffix}` },
      payload: {
        nodes: [
          { key: 'a', title: 'A' },
          { key: 'b', title: 'B' },
          { key: 'c', title: 'C' },
        ],
        edges: [
          { sourceKey: 'a', targetKey: 'b' },
          { sourceKey: 'b', targetKey: 'c' },
        ],
      },
    });
    expect(created.statusCode, created.body).toBe(201);

    const graphResponse = await server.inject({
      method: 'GET',
      url: `/api/requirements/${requirement.id}/work-graph`,
    });
    expect(graphResponse.statusCode).toBe(200);
    const graph = graphResponse.json<{
      graphVersion: number;
      nodes: Array<{ key: string; workItemId: string; entityVersion: number }>;
    }>();
    const nodeA = graph.nodes.find((node) => node.key === 'a');
    const nodeB = graph.nodes.find((node) => node.key === 'b');
    const nodeC = graph.nodes.find((node) => node.key === 'c');
    if (!nodeA || !nodeB || !nodeC) throw new Error('graph nodes were not created');

    const cancelB = await server.inject({
      method: 'POST',
      url: `/api/work-items/${nodeB.workItemId}/transition`,
      headers: {
        'idempotency-key': `cancel-b-${suffix}`,
        'if-match': String(nodeB.entityVersion),
      },
      payload: { toStatus: 'canceled', expectedGraphVersion: graph.graphVersion },
    });
    expect(cancelB.statusCode, cancelB.body).toBe(200);
    expect(
      cancelB.json<{ canceledDescendantWorkItemIds: string[] }>().canceledDescendantWorkItemIds,
    ).toEqual([nodeC.workItemId]);

    const cancelA = await server.inject({
      method: 'POST',
      url: `/api/work-items/${nodeA.workItemId}/transition`,
      headers: {
        'idempotency-key': `cancel-a-${suffix}`,
        'if-match': String(nodeA.entityVersion),
      },
      payload: { toStatus: 'canceled', expectedGraphVersion: graph.graphVersion },
    });
    expect(cancelA.statusCode, cancelA.body).toBe(200);
    expect(
      cancelA.json<{ canceledDescendantWorkItemIds: string[] }>().canceledDescendantWorkItemIds,
    ).toHaveLength(0);

    const finalGraphResponse = await server.inject({
      method: 'GET',
      url: `/api/requirements/${requirement.id}/work-graph`,
    });
    expect(finalGraphResponse.statusCode).toBe(200);
    const finalNodes = finalGraphResponse.json<{
      nodes: Array<{ key: string; status: string; entityVersion: number }>;
    }>().nodes;
    const finalA = finalNodes.find((node) => node.key === 'a');
    const finalB = finalNodes.find((node) => node.key === 'b');
    const finalC = finalNodes.find((node) => node.key === 'c');
    expect(finalA?.status).toBe('canceled');
    expect(finalB?.status).toBe('canceled');
    expect(finalB?.entityVersion).toBe(nodeB.entityVersion + 1);
    expect(finalC?.status).toBe('canceled');

    const requirementResponse = await server.inject({
      method: 'GET',
      url: `/api/requirements/${requirement.id}`,
    });
    expect(requirementResponse.statusCode).toBe(200);
    expect(requirementResponse.json<{ status: string }>().status).toBe('canceled');
  });
});
