import {
  ConflictError,
  NotFoundError,
  validateCreateRoleAssignment,
} from '@helm/core-domain';
import { and, count, eq, type Database, schema } from '@helm/database';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

const roleTypeSchema = z.enum(['owner', 'admin', 'member', 'viewer']);

const createBodySchema = z.object({
  organizationId: z.string().uuid(),
  memberId: z.string().uuid(),
  role: roleTypeSchema,
});

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const querySchema = z.object({
  organizationId: z.string().uuid().optional(),
  memberId: z.string().uuid().optional(),
});

export interface RoleAssignmentRoutesOptions {
  database: Database;
}

function ensureRow<T>(row: T | undefined, label: string): T {
  if (row === undefined) throw new Error(`Unexpected missing row: ${label}`);
  return row;
}

export const roleAssignmentRoutes: FastifyPluginCallback<
  RoleAssignmentRoutesOptions
> = (server, options, done) => {
  const { database } = options;

  // Create role assignment
  server.post('/api/role-assignments', async (request, reply) => {
    const body = createBodySchema.parse(request.body);
    validateCreateRoleAssignment(body);

    // Verify organization exists
    const orgRows = await database
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, body.organizationId))
      .limit(1);

    if (orgRows.length === 0) {
      throw new NotFoundError('Organization', body.organizationId);
    }

    // Verify member exists and belongs to same org
    const memberRows = await database
      .select({
        id: schema.members.id,
        organizationId: schema.members.organizationId,
      })
      .from(schema.members)
      .where(eq(schema.members.id, body.memberId))
      .limit(1);

    if (memberRows.length === 0) {
      throw new NotFoundError('Member', body.memberId);
    }
    const member = ensureRow(memberRows[0], 'member');
    if (member.organizationId !== body.organizationId) {
      throw new ConflictError(
        'Member does not belong to the specified organization',
      );
    }

    // Check for duplicate (member-org-role combo must be unique)
    const existing = await database
      .select({ count: count() })
      .from(schema.roleAssignments)
      .where(
        and(
          eq(schema.roleAssignments.memberId, body.memberId),
          eq(schema.roleAssignments.organizationId, body.organizationId),
          eq(schema.roleAssignments.role, body.role),
        ),
      );

    const existingCount = ensureRow(existing[0], 'existing count');
    if (existingCount.count > 0) {
      throw new ConflictError(
        'Role assignment already exists for this member, organization, and role',
      );
    }

    const [assignment] = await database
      .insert(schema.roleAssignments)
      .values({
        organizationId: body.organizationId,
        memberId: body.memberId,
        role: body.role,
      })
      .returning();

    void reply.code(201);
    return ensureRow(assignment, 'assignment');
  });

  // List role assignments (optionally filtered)
  server.get('/api/role-assignments', async (request) => {
    const query = querySchema.parse(request.query);

    const conditions = [];
    if (query.organizationId) {
      conditions.push(
        eq(schema.roleAssignments.organizationId, query.organizationId),
      );
    }
    if (query.memberId) {
      conditions.push(
        eq(schema.roleAssignments.memberId, query.memberId),
      );
    }

    const rows = await database
      .select()
      .from(schema.roleAssignments)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(schema.roleAssignments.createdAt);

    return rows;
  });

  // Get role assignment by ID
  server.get('/api/role-assignments/:id', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);

    const rows = await database
      .select()
      .from(schema.roleAssignments)
      .where(eq(schema.roleAssignments.id, id))
      .limit(1);

    if (rows.length === 0) {
      void reply.code(404);
      throw new NotFoundError('RoleAssignment', id);
    }

    return ensureRow(rows[0], 'roleAssignment');
  });

  done();
};
