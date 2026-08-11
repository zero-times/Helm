import {
  NotFoundError,
  assertAccountableIsHuman,
  assertSameOrganization,
  validateCreateRequirement,
} from '@helm/core-domain';
import { and, eq, inArray, type Database, schema } from '@helm/database';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

const createBodySchema = z.object({
  projectId: z.string().uuid(),
  goal: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  accountableHumanId: z.string().uuid(),
  operationalOwnerId: z.string().uuid(),
  assigneeMemberId: z.string().uuid(),
});

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const querySchema = z.object({
  projectId: z.string().uuid().optional(),
});

export interface RequirementRoutesOptions {
  database: Database;
}

function ensureRow<T>(row: T | undefined, label: string): T {
  if (row === undefined) throw new Error(`Unexpected missing row: ${label}`);
  return row;
}

export const requirementRoutes: FastifyPluginCallback<
  RequirementRoutesOptions
> = (server, options, done) => {
  const { database } = options;

  // Create requirement
  server.post('/api/requirements', async (request, reply) => {
    const body = createBodySchema.parse(request.body);
    validateCreateRequirement(body);

    // Fetch project and its organization
    const projectRows = await database
      .select({
        id: schema.projects.id,
        organizationId: schema.projects.organizationId,
      })
      .from(schema.projects)
      .where(eq(schema.projects.id, body.projectId))
      .limit(1);

    if (projectRows.length === 0) {
      throw new NotFoundError('Project', body.projectId);
    }

    const project = ensureRow(projectRows[0], 'project');

    // Fetch all three referenced members in a single query
    const memberIds = [
      body.accountableHumanId,
      body.operationalOwnerId,
      body.assigneeMemberId,
    ];
    const memberRows = await database
      .select()
      .from(schema.members)
      .where(
        and(
          eq(schema.members.organizationId, project.organizationId),
          inArray(schema.members.id, memberIds),
        ),
      );

    // Verify accountable human
    const accountableMember = memberRows.find(
      (m) => m.id === body.accountableHumanId,
    );
    if (!accountableMember) {
      throw new NotFoundError('Member', body.accountableHumanId);
    }
    assertAccountableIsHuman(accountableMember, project.organizationId);

    // Verify operational owner
    const operationalOwner = memberRows.find(
      (m) => m.id === body.operationalOwnerId,
    );
    if (!operationalOwner) {
      throw new NotFoundError('Member', body.operationalOwnerId);
    }
    assertSameOrganization(
      operationalOwner,
      project.organizationId,
      'operationalOwnerId',
    );

    // Verify assignee
    const assignee = memberRows.find(
      (m) => m.id === body.assigneeMemberId,
    );
    if (!assignee) {
      throw new NotFoundError('Member', body.assigneeMemberId);
    }
    assertSameOrganization(
      assignee,
      project.organizationId,
      'assigneeMemberId',
    );

    const [requirement] = await database
      .insert(schema.requirements)
      .values({
        projectId: body.projectId,
        goal: body.goal,
        acceptanceCriteria: body.acceptanceCriteria,
        accountableHumanId: body.accountableHumanId,
        operationalOwnerId: body.operationalOwnerId,
        assigneeMemberId: body.assigneeMemberId,
      })
      .returning();

    void reply.code(201);
    return requirement;
  });

  // List requirements (optionally filtered by project)
  server.get('/api/requirements', async (request) => {
    const query = querySchema.parse(request.query);

    const conditions = [];
    if (query.projectId) {
      conditions.push(
        eq(schema.requirements.projectId, query.projectId),
      );
    }

    const rows = await database
      .select()
      .from(schema.requirements)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(schema.requirements.createdAt);

    return rows;
  });

  // Get requirement by ID with responsibility member details
  server.get('/api/requirements/:id', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);

    const rows = await database
      .select()
      .from(schema.requirements)
      .where(eq(schema.requirements.id, id))
      .limit(1);

    if (rows.length === 0) {
      void reply.code(404);
      throw new NotFoundError('Requirement', id);
    }

    const requirement = ensureRow(rows[0], 'requirement');

    // Fetch all three responsibility member details
    const memberIds = [
      requirement.accountableHumanId,
      requirement.operationalOwnerId,
      requirement.assigneeMemberId,
    ];
    const memberDetails = await database
      .select({
        id: schema.members.id,
        name: schema.members.name,
        memberType: schema.members.memberType,
      })
      .from(schema.members)
      .where(inArray(schema.members.id, memberIds));

    return {
      ...requirement,
      accountableHuman: memberDetails.find(
        (m) => m.id === requirement.accountableHumanId,
      ) ?? null,
      operationalOwner: memberDetails.find(
        (m) => m.id === requirement.operationalOwnerId,
      ) ?? null,
      assignee: memberDetails.find(
        (m) => m.id === requirement.assigneeMemberId,
      ) ?? null,
    };
  });

  // Responsibility view: get requirements by assignee
  server.get('/api/requirements/by-assignee/:memberId', async (request) => {
    const { memberId } = z
      .object({ memberId: z.string().uuid() })
      .parse(request.params);

    const rows = await database
      .select()
      .from(schema.requirements)
      .where(eq(schema.requirements.assigneeMemberId, memberId))
      .orderBy(schema.requirements.createdAt);

    return rows;
  });

  done();
};
