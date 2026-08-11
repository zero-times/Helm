import { randomUUID } from 'node:crypto';

import {
  createDatabase,
  eq,
  migrateDatabase,
  schema,
} from '@helm/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://helm:helm@localhost:5432/helm';
const connection = createDatabase(databaseUrl, { maxConnections: 2 });
const createdOrganizationIds: string[] = [];

const server = buildApp({
  config: {
    APP_VERSION: 'test',
    WEB_ORIGIN: 'http://localhost:5173',
  },
  checkDatabase: () => Promise.resolve(),
  database: connection.database,
  logger: false,
});

beforeAll(async () => {
  await migrateDatabase(connection.database);
  await server.ready();
});

afterAll(async () => {
  for (const organizationId of createdOrganizationIds) {
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

describe('core-domain API', () => {
  it('creates and queries projects, requirements, and responsibility assignments', async () => {
    const suffix = randomUUID();
    const organizationResponse = await server.inject({
      method: 'POST',
      url: '/api/organizations',
      payload: { name: 'API Test Organization', slug: `api-${suffix}` },
    });
    expect(organizationResponse.statusCode).toBe(201);
    const organization = organizationResponse.json<{ id: string }>();
    createdOrganizationIds.push(organization.id);

    const humanResponse = await server.inject({
      method: 'POST',
      url: '/api/members',
      payload: {
        organizationId: organization.id,
        memberType: 'human',
        name: 'Accountable Human',
      },
    });
    expect(humanResponse.statusCode).toBe(201);
    const human = humanResponse.json<{ id: string }>();

    const agentResponse = await server.inject({
      method: 'POST',
      url: '/api/members',
      payload: {
        organizationId: organization.id,
        memberType: 'agent',
        name: 'Operational Agent',
      },
    });
    expect(agentResponse.statusCode).toBe(201);
    const agent = agentResponse.json<{ id: string }>();

    const roleResponse = await server.inject({
      method: 'POST',
      url: '/api/role-assignments',
      payload: {
        organizationId: organization.id,
        memberId: human.id,
        role: 'owner',
      },
    });
    expect(roleResponse.statusCode).toBe(201);
    const role = roleResponse.json<{ id: string }>();

    const projectResponse = await server.inject({
      method: 'POST',
      url: '/api/projects',
      payload: {
        organizationId: organization.id,
        name: 'Core Domain',
        slug: `core-${suffix}`,
        accountableHumanId: human.id,
        operationalOwnerId: agent.id,
      },
    });
    expect(projectResponse.statusCode).toBe(201);
    const project = projectResponse.json<{ id: string }>();

    const requirementResponse = await server.inject({
      method: 'POST',
      url: '/api/requirements',
      payload: {
        projectId: project.id,
        goal: 'Expose responsibility assignments',
        acceptanceCriteria: ['The accountable Human is traceable'],
        accountableHumanId: human.id,
        operationalOwnerId: agent.id,
        assigneeMemberId: agent.id,
      },
    });
    expect(requirementResponse.statusCode).toBe(201);
    const requirement = requirementResponse.json<{ id: string }>();

    const projectView = await server.inject({
      method: 'GET',
      url: `/api/projects/${project.id}`,
    });
    expect(projectView.statusCode).toBe(200);
    expect(projectView.json()).toMatchObject({
      id: project.id,
      accountableHuman: { id: human.id, memberType: 'human' },
      operationalOwner: { id: agent.id, memberType: 'agent' },
    });

    const requirementView = await server.inject({
      method: 'GET',
      url: `/api/requirements/${requirement.id}`,
    });
    expect(requirementView.statusCode).toBe(200);
    expect(requirementView.json()).toMatchObject({
      id: requirement.id,
      accountableHuman: { id: human.id, memberType: 'human' },
      operationalOwner: { id: agent.id, memberType: 'agent' },
      assignee: { id: agent.id, memberType: 'agent' },
    });

    const assignments = await server.inject({
      method: 'GET',
      url: `/api/role-assignments?memberId=${human.id}`,
    });
    expect(assignments.statusCode).toBe(200);
    expect(assignments.json()).toContainEqual(
      expect.objectContaining({ id: role.id, role: 'owner' }),
    );

    const assignedRequirements = await server.inject({
      method: 'GET',
      url: `/api/requirements/by-assignee/${agent.id}`,
    });
    expect(assignedRequirements.statusCode).toBe(200);
    expect(assignedRequirements.json()).toContainEqual(
      expect.objectContaining({ id: requirement.id }),
    );

    const nonHumanAccountability = await server.inject({
      method: 'POST',
      url: '/api/requirements',
      payload: {
        projectId: project.id,
        goal: 'Invalid accountability',
        acceptanceCriteria: ['Must be rejected'],
        accountableHumanId: agent.id,
        operationalOwnerId: agent.id,
        assigneeMemberId: agent.id,
      },
    });
    expect(nonHumanAccountability.statusCode).toBe(422);
    expect(nonHumanAccountability.json()).toMatchObject({
      error: 'ACCOUNTABLE_HUMAN_REQUIRED',
    });
  });
});
