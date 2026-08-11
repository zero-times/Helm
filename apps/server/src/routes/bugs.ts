import { randomUUID } from 'node:crypto';

import { BugBlockingPolicy, BugQaWorkflowService } from '@helm/bug-qa';
import {
  PostgresBugRepository,
  PostgresPassedReviewGateReader,
} from '@helm/bug-qa/postgres';
import { ConflictError, NotFoundError } from '@helm/core-domain';
import { and, eq, schema, type Database } from '@helm/database';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

const uuidParams = z.object({ id: z.string().uuid() });
const timestamp = z.string().datetime({ offset: true });

export interface BugRoutesOptions {
  database: Database;
}

export const bugRoutes: FastifyPluginCallback<BugRoutesOptions> = (
  server,
  options,
  done,
) => {
  const repository = new PostgresBugRepository(options.database);
  const service = new BugQaWorkflowService(
    repository,
    new PostgresPassedReviewGateReader(options.database),
  );
  const blockingPolicy = new BugBlockingPolicy(repository);

  const assertRequirementExists = async (requirementId: string): Promise<void> => {
    const rows = await options.database
      .select({ id: schema.requirements.id })
      .from(schema.requirements)
      .where(eq(schema.requirements.id, requirementId))
      .limit(1);
    if (!rows[0]) throw new NotFoundError('Requirement', requirementId);
  };

  server.post('/api/requirements/:id/bugs', async (request, reply) => {
    const { id: sourceRequirementId } = uuidParams.parse(request.params);
    const body = z
      .object({
        graphVersion: z.number().int().positive(),
        title: z.string().trim().min(1),
        description: z.string().trim().min(1),
        discoveredIn: z.enum([
          'requirement',
          'design',
          'implementation',
          'review',
          'qa',
          'release',
          'production',
        ]),
        severity: z.enum(['low', 'medium', 'high', 'critical']),
        blocking: z.boolean(),
        reporterMemberId: z.string().uuid(),
        createdAt: timestamp.optional(),
      })
      .parse(request.body);

    const rows = await options.database
      .select({
        graphVersion: schema.workGraphs.graphVersion,
        organizationId: schema.projects.organizationId,
      })
      .from(schema.requirements)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.requirements.projectId))
      .innerJoin(
        schema.workGraphs,
        eq(schema.workGraphs.requirementId, schema.requirements.id),
      )
      .where(eq(schema.requirements.id, sourceRequirementId))
      .limit(1);
    const requirement = rows[0];
    if (!requirement) throw new NotFoundError('Requirement', sourceRequirementId);
    if (requirement.graphVersion !== body.graphVersion) {
      throw new ConflictError(
        `Expected graph version ${body.graphVersion}, got ${requirement.graphVersion}`,
      );
    }
    const reporters = await options.database
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(
        and(
          eq(schema.members.id, body.reporterMemberId),
          eq(schema.members.organizationId, requirement.organizationId),
        ),
      )
      .limit(1);
    if (!reporters[0]) {
      throw new ConflictError('QA reporter must belong to the Requirement organization');
    }

    const bug = await service.create({
      id: randomUUID(),
      sourceRequirementId,
      graphVersion: body.graphVersion,
      title: body.title,
      description: body.description,
      discoveredIn: body.discoveredIn,
      severity: body.severity,
      blocking: body.blocking,
      reporterMemberId: body.reporterMemberId,
      reporterRole: 'qa',
      createdAt: body.createdAt ?? new Date(),
    });
    void reply.code(201);
    return bug;
  });

  server.get('/api/requirements/:id/bugs', async (request) => {
    const { id: requirementId } = uuidParams.parse(request.params);
    return { bugs: await repository.listBugsForRequirement(requirementId) };
  });

  server.get('/api/bugs/:id', async (request) => {
    const { id } = uuidParams.parse(request.params);
    const bug = await repository.findBug(id);
    if (!bug) throw new NotFoundError('Bug', id);
    return {
      bug,
      fixes: await repository.listFixesForBug(id),
      regressions: await repository.listRegressionsForBug(id),
    };
  });

  server.post('/api/bugs/:id/start-fix', async (request) => {
    const { id: bugId } = uuidParams.parse(request.params);
    const body = z
      .object({
        expectedBugVersion: z.number().int().positive(),
        occurredAt: timestamp.optional(),
      })
      .parse(request.body);
    return service.startFix({
      bugId,
      expectedBugVersion: body.expectedBugVersion,
      occurredAt: body.occurredAt ?? new Date(),
    });
  });

  server.post('/api/bugs/:id/submit-fix', async (request, reply) => {
    const { id: bugId } = uuidParams.parse(request.params);
    const body = z
      .object({
        expectedBugVersion: z.number().int().positive(),
        executionId: z.string().uuid(),
        resultId: z.string().uuid(),
        reviewId: z.string().uuid(),
        passedGateId: z.string().uuid(),
        qaMemberId: z.string().uuid(),
        occurredAt: timestamp.optional(),
      })
      .parse(request.body);
    const bugRows = await options.database
      .select({ organizationId: schema.projects.organizationId })
      .from(schema.bugWorkItems)
      .innerJoin(
        schema.requirements,
        eq(schema.requirements.id, schema.bugWorkItems.sourceRequirementId),
      )
      .innerJoin(schema.projects, eq(schema.projects.id, schema.requirements.projectId))
      .where(eq(schema.bugWorkItems.id, bugId))
      .limit(1);
    if (!bugRows[0]) throw new NotFoundError('Bug', bugId);
    const qaMembers = await options.database
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(
        and(
          eq(schema.members.id, body.qaMemberId),
          eq(schema.members.organizationId, bugRows[0].organizationId),
        ),
      )
      .limit(1);
    if (!qaMembers[0]) {
      throw new ConflictError('QA assignee must belong to the Requirement organization');
    }
    const submitted = await service.submitFixForQa({
      bugId,
      expectedBugVersion: body.expectedBugVersion,
      fixEdgeId: randomUUID(),
      executionId: body.executionId,
      resultId: body.resultId,
      reviewId: body.reviewId,
      passedGateId: body.passedGateId,
      regressionEdgeId: randomUUID(),
      qaMemberId: body.qaMemberId,
      occurredAt: body.occurredAt ?? new Date(),
    });
    void reply.code(201);
    return submitted;
  });

  server.post('/api/qa-regressions/:id/complete', async (request) => {
    const { id: regressionEdgeId } = uuidParams.parse(request.params);
    const body = z
      .object({
        expectedRegressionVersion: z.number().int().positive(),
        expectedBugVersion: z.number().int().positive(),
        outcome: z.enum(['passed', 'failed']),
        notes: z.string().trim().min(1).optional(),
        occurredAt: timestamp.optional(),
      })
      .parse(request.body);
    return service.completeRegression({
      regressionEdgeId,
      expectedRegressionVersion: body.expectedRegressionVersion,
      expectedBugVersion: body.expectedBugVersion,
      outcome: body.outcome,
      ...(body.notes ? { notes: body.notes } : {}),
      occurredAt: body.occurredAt ?? new Date(),
    });
  });

  server.get('/api/requirements/:id/release-gate', async (request) => {
    const { id: requirementId } = uuidParams.parse(request.params);
    await assertRequirementExists(requirementId);
    return blockingPolicy.evaluateRequirement({ requirementId });
  });

  server.post('/api/requirements/:id/release-gate', async (request) => {
    const { id: requirementId } = uuidParams.parse(request.params);
    await assertRequirementExists(requirementId);
    await blockingPolicy.assertRequirementCanRelease({ requirementId });
    return { requirementId, releasable: true };
  });

  done();
};
