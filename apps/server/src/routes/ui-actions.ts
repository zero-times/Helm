import { BugBlockingPolicy } from '@helm/bug-qa';
import { PostgresBugRepository } from '@helm/bug-qa/postgres';
import { OptimisticConcurrencyError } from '@helm/audit-events';
import { ConflictError, NotFoundError } from '@helm/core-domain';
import { eq, schema, type Database } from '@helm/database';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

import { executeAuditedCommand } from '../audited-command';

const uuidParams = z.object({ id: z.string().uuid() });
const commandHeaders = z.object({
  'idempotency-key': z.string().trim().min(1).optional(),
  'if-match': z.coerce.number().int().positive().optional(),
  'x-actor-member-id': z.string().uuid().optional(),
});

export interface UiActionRoutesOptions {
  database: Database;
}

async function workItemContext(database: Database, workItemId: string) {
  const [context] = await database
    .select({
      organizationId: schema.projects.organizationId,
      actorMemberId: schema.requirements.accountableHumanId,
      graphVersion: schema.workGraphs.graphVersion,
      entityVersion: schema.workItems.entityVersion,
    })
    .from(schema.workItems)
    .innerJoin(schema.graphNodes, eq(schema.graphNodes.id, schema.workItems.graphNodeId))
    .innerJoin(schema.workGraphs, eq(schema.workGraphs.id, schema.graphNodes.graphId))
    .innerJoin(schema.requirements, eq(schema.requirements.id, schema.workGraphs.requirementId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.requirements.projectId))
    .where(eq(schema.workItems.id, workItemId))
    .limit(1);
  if (!context) throw new NotFoundError('WorkItem', workItemId);
  return context;
}

async function requirementContext(database: Database, requirementId: string) {
  const [context] = await database
    .select({
      organizationId: schema.projects.organizationId,
      actorMemberId: schema.requirements.accountableHumanId,
      status: schema.requirements.status,
    })
    .from(schema.requirements)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.requirements.projectId))
    .where(eq(schema.requirements.id, requirementId))
    .limit(1);
  if (!context) throw new NotFoundError('Requirement', requirementId);
  return context;
}

export const uiActionRoutes: FastifyPluginCallback<UiActionRoutesOptions> = (
  server,
  options,
  done,
) => {
  server.post('/api/v1/work-items/:id/comments', async (request) => {
    const { id: workItemId } = uuidParams.parse(request.params);
    const headers = commandHeaders.parse(request.headers);
    const body = z.object({ body: z.string().trim().min(1) }).parse(request.body);
    const context = await workItemContext(options.database, workItemId);
    if (headers['if-match'] !== undefined && headers['if-match'] !== context.entityVersion) {
      throw new OptimisticConcurrencyError(
        'work_item',
        workItemId,
        headers['if-match'],
        context.entityVersion,
      );
    }
    const outcome = await executeAuditedCommand(options.database, {
      organizationId: context.organizationId,
      commandType: 'AddWorkItemComment',
      idempotencyKey: headers['idempotency-key'] ?? request.id,
      actorMemberId: headers['x-actor-member-id'] ?? context.actorMemberId,
      source: 'human',
      payload: body,
      entityType: 'work_item',
      entityId: workItemId,
      workItemId,
      graphVersion: context.graphVersion,
      eventType: 'WorkItem.CommentAdded',
      category: 'comment',
      summary: body.body,
      details: { body: body.body },
      mutate: () => Promise.resolve({
        result: { workItemId, body: body.body },
        entityVersion: context.entityVersion,
      }),
    });
    return outcome.result;
  });

  server.post('/api/v1/releases/:id/gate', async (request) => {
    const { id: requirementId } = uuidParams.parse(request.params);
    const headers = commandHeaders.parse(request.headers);
    const body = z
      .object({ decision: z.literal('approve'), note: z.string().trim().min(1) })
      .parse(request.body);
    const context = await requirementContext(options.database, requirementId);
    if (context.status !== 'completed') {
      throw new ConflictError('Requirement must be completed before release authorization');
    }
    await new BugBlockingPolicy(
      new PostgresBugRepository(options.database),
    ).assertRequirementCanRelease({ requirementId });
    const outcome = await executeAuditedCommand(options.database, {
      organizationId: context.organizationId,
      commandType: 'AuthorizeRequirementRelease',
      idempotencyKey: headers['idempotency-key'] ?? request.id,
      actorMemberId: headers['x-actor-member-id'] ?? context.actorMemberId,
      source: 'human',
      payload: body,
      entityType: 'release',
      entityId: requirementId,
      eventType: 'Release.Authorized',
      category: 'gate',
      summary: 'Requirement release authorized',
      details: { note: body.note },
      importance: 'important',
      mutate: () => Promise.resolve({
        result: { requirementId, status: 'approved', note: body.note },
        entityVersion: 1,
      }),
    });
    return outcome.result;
  });

  done();
};
