import {
  ConflictError,
  NotFoundError,
  assertAccountableIsHuman,
  assertSameOrganization,
  validateCreateProject,
  type CreateProjectInput,
} from '@helm/core-domain';
import { and, eq, inArray, type Database, schema } from '@helm/database';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

const createBodySchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().nullable().optional(),
  accountableHumanId: z.string().uuid(),
  operationalOwnerId: z.string().uuid(),
});

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const querySchema = z.object({
  organizationId: z.string().uuid().optional(),
});

export interface ProjectRoutesOptions {
  database: Database;
}

function ensureRow<T>(row: T | undefined, label: string): T {
  if (row === undefined) throw new Error(`Unexpected missing row: ${label}`);
  return row;
}

export const projectRoutes: FastifyPluginCallback<ProjectRoutesOptions> = (
  server,
  options,
  done,
) => {
  const { database } = options;

  // Create project with accountability enforcement
  server.post('/api/projects', async (request, reply) => {
    const body = createBodySchema.parse(request.body);
    const input: CreateProjectInput = {
      organizationId: body.organizationId,
      name: body.name,
      slug: body.slug,
      description: body.description ?? null,
      accountableHumanId: body.accountableHumanId,
      operationalOwnerId: body.operationalOwnerId,
    };
    validateCreateProject(input);

    // Verify organization exists
    const orgRows = await database
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, body.organizationId))
      .limit(1);

    if (orgRows.length === 0) {
      throw new NotFoundError('Organization', body.organizationId);
    }

    // Fetch both referenced members in a single query
    const memberRows = await database
      .select()
      .from(schema.members)
      .where(eq(schema.members.organizationId, body.organizationId));

    // Look up accountable human
    const accountableMember = memberRows.find(
      (m) => m.id === body.accountableHumanId,
    );

    if (!accountableMember) {
      throw new NotFoundError('Member', body.accountableHumanId);
    }

    // Enforce: accountable must be Human in the same organization
    assertAccountableIsHuman(accountableMember, body.organizationId);

    // Look up operational owner
    const operationalOwner = memberRows.find(
      (m) => m.id === body.operationalOwnerId,
    );

    if (!operationalOwner) {
      throw new NotFoundError('Member', body.operationalOwnerId);
    }

    // Enforce: operational owner must be in same organization
    assertSameOrganization(
      operationalOwner,
      body.organizationId,
      'operationalOwnerId',
    );

    // Check slug uniqueness within organization
    const existing = await database
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(
        and(
          eq(schema.projects.organizationId, body.organizationId),
          eq(schema.projects.slug, body.slug),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictError(
        'Project slug already exists in this organization',
      );
    }

    const [project] = await database
      .insert(schema.projects)
      .values({
        organizationId: body.organizationId,
        name: body.name,
        slug: body.slug,
        description: body.description ?? null,
        accountableHumanId: body.accountableHumanId,
        operationalOwnerId: body.operationalOwnerId,
      })
      .returning();

    void reply.code(201);
    return project;
  });

  // List projects (optionally filtered by organization)
  server.get('/api/projects', async (request) => {
    const query = querySchema.parse(request.query);

    const conditions = [];
    if (query.organizationId) {
      conditions.push(
        eq(schema.projects.organizationId, query.organizationId),
      );
    }

    const rows = await database
      .select()
      .from(schema.projects)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(schema.projects.createdAt);

    return rows;
  });

  // Get project by ID with member details (responsibility view)
  server.get('/api/projects/:id', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);

    const rows = await database
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .limit(1);

    if (rows.length === 0) {
      void reply.code(404);
      throw new NotFoundError('Project', id);
    }

    const project = ensureRow(rows[0], 'project');

    // Fetch member details for responsibility display
    const memberIds = [project.accountableHumanId, project.operationalOwnerId];
    const memberDetails = await database
      .select({
        id: schema.members.id,
        name: schema.members.name,
        memberType: schema.members.memberType,
      })
      .from(schema.members)
      .where(inArray(schema.members.id, memberIds));

    return {
      ...project,
      accountableHuman: memberDetails.find(
        (m) => m.id === project.accountableHumanId,
      ) ?? null,
      operationalOwner: memberDetails.find(
        (m) => m.id === project.operationalOwnerId,
      ) ?? null,
    };
  });

  done();
};
