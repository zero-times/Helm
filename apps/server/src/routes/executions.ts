import { randomUUID } from 'node:crypto';

import { ConflictError, NotFoundError } from '@helm/core-domain';
import { and, eq, schema, type Database } from '@helm/database';
import type { JsonValue } from '@helm/audit-events';
import {
  ManualExecutionService,
  type ManualExecutionStartGuard,
} from '@helm/execution';
import { PostgresExecutionRepository } from '@helm/execution/postgres';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

import { executeAuditedCommand } from '../audited-command';

const uuidParams = z.object({ id: z.string().uuid() });
const timestamp = z.string().datetime({ offset: true });
const versionedCommand = z.object({
  expectedVersion: z.number().int().positive(),
  occurredAt: timestamp.optional(),
});
const artifact = z.object({
  id: z.string().uuid(),
  kind: z.enum(['file', 'url', 'commit', 'patch', 'log', 'report', 'other']),
  name: z.string().trim().min(1),
  uri: z.string().trim().min(1),
  mediaType: z.string().trim().min(1).optional(),
  digest: z
    .object({ algorithm: z.literal('sha256'), value: z.string().trim().min(1) })
    .optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  metadata: z.record(z.string(), z.json()).optional(),
});
const testResult = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1),
  status: z.enum(['passed', 'failed', 'skipped', 'not_run']),
  command: z.string().trim().min(1).optional(),
  details: z.string().trim().min(1).optional(),
  artifactIds: z.array(z.string().uuid()).optional(),
});
const knownIssue = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  blocking: z.boolean(),
});
const resultContract = z.object({
  id: z.string().uuid().optional(),
  summary: z.string().trim().min(1),
  changedFiles: z.array(z.string().trim().min(1)).optional(),
  changeSet: z
    .object({
      kind: z.enum(['commit', 'patch', 'branch', 'other']),
      reference: z.string().trim().min(1),
    })
    .optional(),
  commitReference: z.string().trim().min(1).optional(),
  tests: z.array(testResult).optional(),
  artifacts: z.array(artifact).optional(),
  knownIssues: z.array(knownIssue).optional(),
  needsHumanDecision: z.boolean().optional(),
  humanDecision: z
    .object({
      question: z.string().trim().min(1),
      context: z.string().trim().min(1),
      options: z.array(z.string().trim().min(1)).optional(),
    })
    .optional(),
  sessionReference: z
    .object({
      provider: z.string().trim().min(1),
      externalSessionId: z.string().trim().min(1),
      machineId: z.string().trim().min(1).optional(),
      workspacePath: z.string().trim().min(1).optional(),
    })
    .optional(),
  actualCost: z
    .object({
      currency: z.string().trim().min(1),
      minorUnits: z.number().int().nonnegative(),
    })
    .optional(),
  durationMs: z.number().int().nonnegative().optional(),
  verificationSource: z.enum([
    'unverified',
    'agent_reported',
    'runner_verified',
    'ci_verified',
    'human_verified',
  ]),
});
const finishCommand = z.object({
  expectedVersion: z.number().int().positive(),
  outcome: z.enum(['completed', 'failed', 'cancelled']),
  endedAt: timestamp.optional(),
  endReason: z.string().trim().min(1).optional(),
  result: resultContract,
});
const commandHeaders = z.object({
  'idempotency-key': z.string().trim().min(1).optional(),
  'x-actor-member-id': z.string().uuid().optional(),
  'x-command-source': z.string().trim().min(1).optional(),
});

export interface ExecutionRoutesOptions {
  database: Database;
}

class DatabaseManualExecutionStartGuard implements ManualExecutionStartGuard {
  constructor(readonly database: Database) {}

  async assertCanStart(input: {
    workItemId: string;
    graphVersion: number;
    executorMemberId: string;
  }): Promise<void> {
    const rows = await this.database
      .select({
        status: schema.workItems.status,
        graphVersion: schema.workGraphs.graphVersion,
        organizationId: schema.projects.organizationId,
      })
      .from(schema.workItems)
      .innerJoin(schema.graphNodes, eq(schema.graphNodes.id, schema.workItems.graphNodeId))
      .innerJoin(schema.workGraphs, eq(schema.workGraphs.id, schema.graphNodes.graphId))
      .innerJoin(
        schema.requirements,
        eq(schema.requirements.id, schema.workGraphs.requirementId),
      )
      .innerJoin(schema.projects, eq(schema.projects.id, schema.requirements.projectId))
      .where(eq(schema.workItems.id, input.workItemId))
      .limit(1);
    const workItem = rows[0];
    if (!workItem) throw new NotFoundError('WorkItem', input.workItemId);
    if (workItem.graphVersion !== input.graphVersion) {
      throw new ConflictError(
        `Expected graph version ${input.graphVersion}, got ${workItem.graphVersion}`,
      );
    }
    if (workItem.status !== 'ready') {
      throw new ConflictError(
        `WorkItem ${input.workItemId} must be ready to start execution; got ${workItem.status}`,
      );
    }
    const members = await this.database
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(
        and(
          eq(schema.members.id, input.executorMemberId),
          eq(schema.members.organizationId, workItem.organizationId),
        ),
      )
      .limit(1);
    if (!members[0]) {
      throw new ConflictError(
        `Executor ${input.executorMemberId} must belong to the WorkItem organization`,
      );
    }
  }
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

async function workItemContext(database: Database, workItemId: string) {
  const rows = await database
    .select({
      organizationId: schema.projects.organizationId,
      accountableHumanId: schema.requirements.accountableHumanId,
      graphVersion: schema.workGraphs.graphVersion,
    })
    .from(schema.workItems)
    .innerJoin(schema.graphNodes, eq(schema.graphNodes.id, schema.workItems.graphNodeId))
    .innerJoin(schema.workGraphs, eq(schema.workGraphs.id, schema.graphNodes.graphId))
    .innerJoin(schema.requirements, eq(schema.requirements.id, schema.workGraphs.requirementId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.requirements.projectId))
    .where(eq(schema.workItems.id, workItemId))
    .limit(1);
  const context = rows[0];
  if (!context) throw new NotFoundError('WorkItem', workItemId);
  return context;
}

async function executionContext(database: Database, executionId: string) {
  const rows = await database
    .select({
      workItemId: schema.manualExecutions.workItemId,
      organizationId: schema.projects.organizationId,
      accountableHumanId: schema.requirements.accountableHumanId,
      graphVersion: schema.manualExecutions.graphVersion,
    })
    .from(schema.manualExecutions)
    .innerJoin(schema.workItems, eq(schema.workItems.id, schema.manualExecutions.workItemId))
    .innerJoin(schema.graphNodes, eq(schema.graphNodes.id, schema.workItems.graphNodeId))
    .innerJoin(schema.workGraphs, eq(schema.workGraphs.id, schema.graphNodes.graphId))
    .innerJoin(schema.requirements, eq(schema.requirements.id, schema.workGraphs.requirementId))
    .innerJoin(schema.projects, eq(schema.projects.id, schema.requirements.projectId))
    .where(eq(schema.manualExecutions.id, executionId))
    .limit(1);
  const context = rows[0];
  if (!context) throw new NotFoundError('Execution', executionId);
  return context;
}

export const executionRoutes: FastifyPluginCallback<ExecutionRoutesOptions> = (
  server,
  options,
  done,
) => {
  const repository = new PostgresExecutionRepository(options.database);

  server.post('/api/work-items/:id/executions', async (request, reply) => {
    const { id: workItemId } = uuidParams.parse(request.params);
    const headers = commandHeaders.parse(request.headers);
    const body = z
      .object({
        graphVersion: z.number().int().positive(),
        mode: z.enum(['self', 'external_manual']),
        executorMemberId: z.string().uuid(),
        startedAt: timestamp.optional(),
      })
      .parse(request.body);
    const context = await workItemContext(options.database, workItemId);
    const executionId = randomUUID();
    const outcome = await executeAuditedCommand(options.database, {
      organizationId: context.organizationId,
      commandType: 'StartManualExecution',
      idempotencyKey: headers['idempotency-key'] ?? request.id,
      actorMemberId: headers['x-actor-member-id'] ?? body.executorMemberId,
      source: headers['x-command-source'] ?? 'human',
      payload: toJson(body),
      entityType: 'execution',
      entityId: executionId,
      workItemId,
      executionId,
      graphVersion: context.graphVersion,
      eventType: 'Execution.Started',
      category: 'execution',
      summary: 'Manual execution started',
      mutate: async (tx) => {
        const txDatabase = tx as unknown as Database;
        const txService = new ManualExecutionService(
          new PostgresExecutionRepository(txDatabase),
          new DatabaseManualExecutionStartGuard(txDatabase),
        );
        const execution = await txService.start({
          id: executionId,
          workItemId,
          graphVersion: body.graphVersion,
          mode: body.mode,
          executorMemberId: body.executorMemberId,
          startedAt: body.startedAt ?? new Date(),
        });
        return { result: toJson(execution), entityVersion: execution.version };
      },
    });
    void reply.header('Idempotency-Replayed', String(outcome.replayed));
    void reply.code(201);
    return outcome.result;
  });

  server.get('/api/work-items/:id/executions', async (request) => {
    const { id: workItemId } = uuidParams.parse(request.params);
    return {
      executions: await repository.listExecutionsForWorkItem(workItemId),
      results: await repository.listResultsForWorkItem(workItemId),
    };
  });

  server.get('/api/executions/:id', async (request) => {
    const { id } = uuidParams.parse(request.params);
    const execution = await repository.findExecution(id);
    if (!execution) throw new NotFoundError('Execution', id);
    return execution;
  });

  server.get('/api/executions/:id/result', async (request) => {
    const { id } = uuidParams.parse(request.params);
    const result = await repository.findResultByExecutionId(id);
    if (!result) throw new NotFoundError('ExecutionResult', id);
    return result;
  });

  server.post('/api/executions/:id/wait-for-input', async (request) => {
    const { id: executionId } = uuidParams.parse(request.params);
    const headers = commandHeaders.parse(request.headers);
    const body = versionedCommand
      .extend({ reason: z.string().trim().min(1) })
      .parse(request.body);
    const context = await executionContext(options.database, executionId);
    const outcome = await executeAuditedCommand(options.database, {
      organizationId: context.organizationId,
      commandType: 'WaitForExecutionInput',
      idempotencyKey: headers['idempotency-key'] ?? request.id,
      actorMemberId: headers['x-actor-member-id'] ?? context.accountableHumanId,
      source: headers['x-command-source'] ?? 'human',
      payload: toJson(body),
      entityType: 'execution', entityId: executionId, executionId,
      workItemId: context.workItemId, graphVersion: context.graphVersion,
      eventType: 'Execution.WaitingForInput', category: 'execution',
      summary: 'Execution is waiting for input',
      mutate: async (tx) => {
        const txService = new ManualExecutionService(
          new PostgresExecutionRepository(tx as unknown as Database),
        );
        const execution = await txService.waitForInput({
          executionId,
          expectedVersion: body.expectedVersion,
          reason: body.reason,
          occurredAt: body.occurredAt ?? new Date(),
        });
        return { result: toJson(execution), entityVersion: execution.version };
      },
    });
    return outcome.result;
  });

  server.post('/api/executions/:id/resume', async (request) => {
    const { id: executionId } = uuidParams.parse(request.params);
    const headers = commandHeaders.parse(request.headers);
    const body = versionedCommand.parse(request.body);
    const context = await executionContext(options.database, executionId);
    const outcome = await executeAuditedCommand(options.database, {
      organizationId: context.organizationId,
      commandType: 'ResumeManualExecution',
      idempotencyKey: headers['idempotency-key'] ?? request.id,
      actorMemberId: headers['x-actor-member-id'] ?? context.accountableHumanId,
      source: headers['x-command-source'] ?? 'human',
      payload: toJson(body),
      entityType: 'execution', entityId: executionId, executionId,
      workItemId: context.workItemId, graphVersion: context.graphVersion,
      eventType: 'Execution.Resumed', category: 'execution',
      summary: 'Execution resumed',
      mutate: async (tx) => {
        const txService = new ManualExecutionService(
          new PostgresExecutionRepository(tx as unknown as Database),
        );
        const execution = await txService.resume({
          executionId,
          expectedVersion: body.expectedVersion,
          occurredAt: body.occurredAt ?? new Date(),
        });
        return { result: toJson(execution), entityVersion: execution.version };
      },
    });
    return outcome.result;
  });

  server.post('/api/executions/:id/finish', async (request) => {
    const { id: executionId } = uuidParams.parse(request.params);
    const headers = commandHeaders.parse(request.headers);
    const body = finishCommand.parse(request.body);
    const context = await executionContext(options.database, executionId);
    const finishInput = {
      executionId,
      expectedVersion: body.expectedVersion,
      outcome: body.outcome,
      endedAt: body.endedAt ?? new Date(),
      ...(body.endReason ? { endReason: body.endReason } : {}),
      result: {
        id: body.result.id ?? randomUUID(),
        summary: body.result.summary,
        verificationSource: body.result.verificationSource,
        ...(body.result.changedFiles
          ? { changedFiles: body.result.changedFiles }
          : {}),
        ...(body.result.changeSet ? { changeSet: body.result.changeSet } : {}),
        ...(body.result.commitReference
          ? { commitReference: body.result.commitReference }
          : {}),
        ...(body.result.tests ? { tests: body.result.tests } : {}),
        ...(body.result.artifacts ? { artifacts: body.result.artifacts } : {}),
        ...(body.result.knownIssues
          ? { knownIssues: body.result.knownIssues }
          : {}),
        ...(body.result.needsHumanDecision !== undefined
          ? { needsHumanDecision: body.result.needsHumanDecision }
          : {}),
        ...(body.result.humanDecision
          ? { humanDecision: body.result.humanDecision }
          : {}),
        ...(body.result.sessionReference
          ? { sessionReference: body.result.sessionReference }
          : {}),
        ...(body.result.actualCost ? { actualCost: body.result.actualCost } : {}),
        ...(body.result.durationMs !== undefined
          ? { durationMs: body.result.durationMs }
          : {}),
      },
    };
    const outcome = await executeAuditedCommand(options.database, {
      organizationId: context.organizationId,
      commandType: 'FinishManualExecution',
      idempotencyKey: headers['idempotency-key'] ?? request.id,
      actorMemberId: headers['x-actor-member-id'] ?? context.accountableHumanId,
      source: headers['x-command-source'] ?? 'human',
      payload: toJson(body),
      entityType: 'execution', entityId: executionId, executionId,
      workItemId: context.workItemId, graphVersion: context.graphVersion,
      eventType: 'Execution.Finished', category: 'execution',
      summary: `Execution ${body.outcome}`,
      importance: body.outcome === 'completed' ? 'important' : 'critical',
      mutate: async (tx) => {
        const txService = new ManualExecutionService(
          new PostgresExecutionRepository(tx as unknown as Database),
        );
        const finished = await txService.finish(finishInput);
        return {
          result: toJson(finished),
          entityVersion: finished.execution.version,
        };
      },
    });
    return outcome.result;
  });

  done();
};
