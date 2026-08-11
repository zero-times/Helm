import {
  NotFoundError,
  validateCreateMember,
  type CreateMemberInput,
} from '@helm/core-domain';
import { and, eq, type Database, schema } from '@helm/database';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

const memberTypeSchema = z.enum(['human', 'agent', 'service']);

const createBodySchema = z.object({
  organizationId: z.string().uuid(),
  memberType: memberTypeSchema,
  name: z.string().min(1),
  email: z.string().email().nullable().optional(),
});

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const querySchema = z.object({
  organizationId: z.string().uuid().optional(),
});

export interface MemberRoutesOptions {
  database: Database;
}

function ensureRow<T>(row: T | undefined, label: string): T {
  if (row === undefined) throw new Error(`Unexpected missing row: ${label}`);
  return row;
}

export const memberRoutes: FastifyPluginCallback<MemberRoutesOptions> = (
  server,
  options,
  done,
) => {
  const { database } = options;

  // Create member
  server.post('/api/members', async (request, reply) => {
    const body = createBodySchema.parse(request.body);
    const input: CreateMemberInput = {
      organizationId: body.organizationId,
      memberType: body.memberType,
      name: body.name,
      email: body.email ?? null,
    };
    validateCreateMember(input);

    // Verify organization exists
    const orgRows = await database
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, body.organizationId))
      .limit(1);

    if (orgRows.length === 0) {
      throw new NotFoundError('Organization', body.organizationId);
    }

    const [member] = await database
      .insert(schema.members)
      .values({
        organizationId: body.organizationId,
        memberType: body.memberType,
        name: body.name,
        email: body.email ?? null,
      })
      .returning();

    void reply.code(201);
    return ensureRow(member, 'member');
  });

  // List members (optionally filtered by organization)
  server.get('/api/members', async (request) => {
    const query = querySchema.parse(request.query);

    const conditions = [];
    if (query.organizationId) {
      conditions.push(
        eq(schema.members.organizationId, query.organizationId),
      );
    }

    const rows = await database
      .select()
      .from(schema.members)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(schema.members.createdAt);

    return rows;
  });

  // Get member by ID
  server.get('/api/members/:id', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);

    const rows = await database
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, id))
      .limit(1);

    if (rows.length === 0) {
      void reply.code(404);
      throw new NotFoundError('Member', id);
    }

    return ensureRow(rows[0], 'member');
  });

  done();
};
