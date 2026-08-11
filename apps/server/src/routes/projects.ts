import {
  ConflictError,
  NonEmptyFieldRequiredError,
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

const patchBodySchema = z.object({
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  accountableHumanId: z.string().uuid().optional(),
  operationalOwnerId: z.string().uuid().optional(),
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

  // Update project (partial)
  server.patch('/api/projects/:id', async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const body = patchBodySchema.parse(request.body);

    // Require at least one field
    const hasAnyField =
      body.name !== undefined ||
      body.slug !== undefined ||
      body.description !== undefined ||
      body.accountableHumanId !== undefined ||
      body.operationalOwnerId !== undefined;

    if (!hasAnyField) {
      throw new NonEmptyFieldRequiredError(
        'at least one of: name, slug, description, accountableHumanId, operationalOwnerId',
      );
    }

    // Load existing project
    const rows = await database
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError('Project', id);
    }

    const project = ensureRow(rows[0], 'project');

    // Validate and trim name
    if (body.name !== undefined) {
      const trimmed = body.name.trim();
      if (!trimmed) throw new NonEmptyFieldRequiredError('name');
      body.name = trimmed;
    }

    // Validate and trim slug
    if (body.slug !== undefined) {
      const trimmed = body.slug.trim();
      if (!trimmed) throw new NonEmptyFieldRequiredError('slug');
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
        throw new ConflictError(
          'slug must be lowercase alphanumeric with hyphens',
        );
      }
      body.slug = trimmed;

      // Slug uniqueness check (exclude current project)
      const sameSlugProjects = await database
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(
          and(
            eq(schema.projects.organizationId, project.organizationId),
            eq(schema.projects.slug, body.slug),
          ),
        );

      const slugConflict = sameSlugProjects.filter(
        (p) => p.id !== id,
      );

      if (slugConflict.length > 0) {
        throw new ConflictError(
          'Project slug already exists in this organization',
        );
      }
    }

    // Handle description (nullable)
    if (body.description !== undefined) {
      body.description = body.description?.trim() ?? null;
    }

    // If member IDs changed, verify them against the project's org
    if (
      body.accountableHumanId !== undefined ||
      body.operationalOwnerId !== undefined
    ) {
      const memberIdsToCheck = new Set<string>();
      if (body.accountableHumanId !== undefined)
        memberIdsToCheck.add(body.accountableHumanId);
      if (body.operationalOwnerId !== undefined)
        memberIdsToCheck.add(body.operationalOwnerId);

      const memberRows = await database
        .select()
        .from(schema.members)
        .where(
          and(
            eq(schema.members.organizationId, project.organizationId),
            inArray(schema.members.id, [...memberIdsToCheck]),
          ),
        );

      if (body.accountableHumanId !== undefined) {
        const accountableMember = memberRows.find(
          (m) => m.id === body.accountableHumanId,
        );
        if (!accountableMember) {
          throw new NotFoundError('Member', body.accountableHumanId);
        }
        assertAccountableIsHuman(accountableMember, project.organizationId);
      }

      if (body.operationalOwnerId !== undefined) {
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
      }
    }

    // Build update payload
    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.slug !== undefined) updateData.slug = body.slug;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.accountableHumanId !== undefined)
      updateData.accountableHumanId = body.accountableHumanId;
    if (body.operationalOwnerId !== undefined)
      updateData.operationalOwnerId = body.operationalOwnerId;
    updateData.updatedAt = new Date();

    const [updated] = await database
      .update(schema.projects)
      .set(updateData)
      .where(eq(schema.projects.id, id))
      .returning();

    return updated;
  });

  // Delete project (only if no requirements exist)
  server.delete('/api/projects/:id', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);

    const rows = await database
      .select({ id: schema.projects.id })
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundError('Project', id);
    }

    // Guard: cannot delete project that still has requirements
    const requirementRows = await database
      .select({ id: schema.requirements.id })
      .from(schema.requirements)
      .where(eq(schema.requirements.projectId, id))
      .limit(1);

    if (requirementRows.length > 0) {
      throw new ConflictError(
        'Project still has requirements. Delete or move all requirements from this project first.',
      );
    }

    await database.delete(schema.projects).where(eq(schema.projects.id, id));

    void reply.code(204);
  });

  done();
};
