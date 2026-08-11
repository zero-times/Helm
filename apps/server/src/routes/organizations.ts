import {
  ConflictError,
  NotFoundError,
  validateCreateOrganization,
} from '@helm/core-domain';
import { eq, type Database, schema } from '@helm/database';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

const createBodySchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
});

const paramsSchema = z.object({
  id: z.string().uuid(),
});

export interface OrganizationRoutesOptions {
  database: Database;
}

function ensureRow<T>(row: T | undefined, label: string): T {
  if (row === undefined) throw new Error(`Unexpected missing row: ${label}`);
  return row;
}

export const organizationRoutes: FastifyPluginCallback<
  OrganizationRoutesOptions
> = (server, options, done) => {
  const { database } = options;

  // Create organization
  server.post('/api/organizations', async (request, reply) => {
    const body = createBodySchema.parse(request.body);
    validateCreateOrganization(body);

    const existing = await database
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, body.slug))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictError('Organization slug already exists');
    }

    const [org] = await database
      .insert(schema.organizations)
      .values({ name: body.name, slug: body.slug })
      .returning();

    void reply.code(201);
    return ensureRow(org, 'org');
  });

  // List organizations
  server.get('/api/organizations', async () => {
    const rows = await database
      .select()
      .from(schema.organizations)
      .orderBy(schema.organizations.createdAt);

    return rows;
  });

  // Get organization by ID
  server.get('/api/organizations/:id', async (request, reply) => {
    const { id } = paramsSchema.parse(request.params);

    const rows = await database
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, id))
      .limit(1);

    if (rows.length === 0) {
      void reply.code(404);
      throw new NotFoundError('Organization', id);
    }

    return ensureRow(rows[0], 'organization');
  });

  done();
};
