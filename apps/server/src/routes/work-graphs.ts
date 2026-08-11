import { randomUUID } from 'node:crypto';

import {
  ConflictError,
  NotFoundError,
  WorkItemStatus,
  assertWorkItemTransition,
} from '@helm/core-domain';
import { OptimisticConcurrencyError } from '@helm/audit-events';
import { and, eq, inArray, type Database, schema } from '@helm/database';
import { HumanGatePolicy, type HumanGate } from '@helm/review';
import { PostgresReviewRepository } from '@helm/review/postgres';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

import { executeAuditedCommand } from '../audited-command';

const uuidParams = z.object({ id: z.string().uuid() });
const createGraphBody = z.object({
  nodes: z
    .array(
      z.object({
        key: z.string().trim().min(1),
        title: z.string().trim().min(1),
        isRequired: z.boolean().default(true),
      }),
    )
    .min(1),
  edges: z.array(
    z.object({
      sourceKey: z.string().trim().min(1),
      targetKey: z.string().trim().min(1),
      isHardDependency: z.boolean().default(true),
    }),
  ),
});
const transitionBody = z.object({
  toStatus: z.enum(['ready', 'in_progress', 'completed', 'failed', 'canceled']),
  expectedGraphVersion: z.number().int().positive(),
});
const idempotencyHeaders = z.object({
  'idempotency-key': z.string().trim().min(1).optional(),
  'x-actor-member-id': z.string().uuid().optional(),
  'x-command-source': z.string().trim().min(1).optional(),
});
const transitionHeaders = idempotencyHeaders.extend({
  'if-match': z.coerce.number().int().positive(),
});

export interface WorkGraphRoutesOptions {
  database: Database;
}

function validateDefinition(body: z.infer<typeof createGraphBody>): void {
  const keys = new Set(body.nodes.map((node) => node.key));
  if (keys.size !== body.nodes.length) throw new ConflictError('Node keys must be unique');
  const adjacency = new Map<string, string[]>();
  for (const edge of body.edges) {
    if (!keys.has(edge.sourceKey) || !keys.has(edge.targetKey)) {
      throw new ConflictError('Every edge must reference nodes in the graph');
    }
    if (edge.sourceKey === edge.targetKey) throw new ConflictError('Self edges are not allowed');
    adjacency.set(edge.sourceKey, [...(adjacency.get(edge.sourceKey) ?? []), edge.targetKey]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key)) throw new ConflictError('Work graph must be acyclic');
    if (visited.has(key)) return;
    visiting.add(key);
    for (const target of adjacency.get(key) ?? []) visit(target);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of keys) visit(key);
}

export const workGraphRoutes: FastifyPluginCallback<WorkGraphRoutesOptions> = (
  server,
  options,
  done,
) => {
  const { database } = options;
  const reviewRepository = new PostgresReviewRepository(database);
  const humanGatePolicy = new HumanGatePolicy(reviewRepository);

  server.post('/api/requirements/:id/work-graph', async (request, reply) => {
    const { id: requirementId } = uuidParams.parse(request.params);
    const body = createGraphBody.parse(request.body);
    const headers = idempotencyHeaders.parse(request.headers);
    validateDefinition(body);

    const requirements = await database
      .select({
        id: schema.requirements.id,
        organizationId: schema.projects.organizationId,
        accountableHumanId: schema.requirements.accountableHumanId,
      })
      .from(schema.requirements)
      .innerJoin(schema.projects, eq(schema.projects.id, schema.requirements.projectId))
      .where(eq(schema.requirements.id, requirementId))
      .limit(1);
    const requirement = requirements[0];
    if (!requirement) throw new NotFoundError('Requirement', requirementId);
    const graphId = randomUUID();

    const outcome = await executeAuditedCommand(database, {
      organizationId: requirement.organizationId,
      commandType: 'CreateWorkGraph',
      idempotencyKey: headers['idempotency-key'] ?? request.id,
      actorMemberId: headers['x-actor-member-id'] ?? requirement.accountableHumanId,
      source: headers['x-command-source'] ?? 'human',
      payload: body,
      entityType: 'work_graph',
      entityId: graphId,
      eventType: 'WorkGraph.Created',
      category: 'state_change',
      summary: 'Work graph created',
      details: { requirementId, nodeCount: body.nodes.length, edgeCount: body.edges.length },
      mutate: async (tx) => {
        const existingRequirement = await tx
        .select({ id: schema.requirements.id })
        .from(schema.requirements)
        .where(eq(schema.requirements.id, requirementId))
        .limit(1);
        if (!existingRequirement[0]) throw new NotFoundError('Requirement', requirementId);

        const [createdGraph] = await tx
        .insert(schema.workGraphs)
        .values({ id: graphId, requirementId })
        .returning();
        if (!createdGraph) throw new Error('Failed to create work graph');

        const nodes = await tx
        .insert(schema.graphNodes)
        .values(body.nodes.map((node) => ({ ...node, graphId: createdGraph.id })))
        .returning();
        const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
        await tx.insert(schema.workItems).values(
          nodes.map((node) => ({ graphNodeId: node.id, status: WorkItemStatus.Pending })),
        );

        if (body.edges.length > 0) {
          await tx.insert(schema.workEdges).values(
            body.edges.map((edge) => ({
              graphId: createdGraph.id,
              sourceNodeId: nodeByKey.get(edge.sourceKey)!.id,
              targetNodeId: nodeByKey.get(edge.targetKey)!.id,
              isHardDependency: edge.isHardDependency,
            })),
          );
        }
        const hardTargets = new Set(
          body.edges.filter((edge) => edge.isHardDependency).map((edge) => edge.targetKey),
        );
        const roots = nodes.filter((node) => !hardTargets.has(node.key));
        if (roots.length > 0) {
          await tx
            .update(schema.workItems)
            .set({ status: WorkItemStatus.Ready, updatedAt: new Date() })
            .where(inArray(schema.workItems.graphNodeId, roots.map((node) => node.id)));
        }
        return {
          result: {
            id: createdGraph.id,
            requirementId: createdGraph.requirementId,
            graphVersion: createdGraph.graphVersion,
            createdAt: createdGraph.createdAt.toISOString(),
            updatedAt: createdGraph.updatedAt.toISOString(),
          },
          entityVersion: createdGraph.graphVersion,
        };
      },
    });

    void reply.header('Idempotency-Replayed', String(outcome.replayed));
    void reply.code(201);
    return outcome.result;
  });

  server.get('/api/requirements/:id/work-graph', async (request) => {
    const { id: requirementId } = uuidParams.parse(request.params);
    const graphs = await database
      .select()
      .from(schema.workGraphs)
      .where(eq(schema.workGraphs.requirementId, requirementId))
      .limit(1);
    const graph = graphs[0];
    if (!graph) throw new NotFoundError('WorkGraph');
    const nodes = await database
      .select({
        id: schema.graphNodes.id,
        key: schema.graphNodes.key,
        title: schema.graphNodes.title,
        isRequired: schema.graphNodes.isRequired,
        workItemId: schema.workItems.id,
        status: schema.workItems.status,
        entityVersion: schema.workItems.entityVersion,
      })
      .from(schema.graphNodes)
      .innerJoin(schema.workItems, eq(schema.workItems.graphNodeId, schema.graphNodes.id))
      .where(eq(schema.graphNodes.graphId, graph.id));
    const edges = await database
      .select()
      .from(schema.workEdges)
      .where(eq(schema.workEdges.graphId, graph.id));
    return { ...graph, nodes, edges };
  });

  server.post('/api/work-items/:id/transition', async (request) => {
    const { id } = uuidParams.parse(request.params);
    const body = transitionBody.parse(request.body);
    const headers = transitionHeaders.parse(request.headers);

    const metadataRows = await database
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
      .where(eq(schema.workItems.id, id))
      .limit(1);
    const metadata = metadataRows[0];
    if (!metadata) throw new NotFoundError('WorkItem', id);

    const outcome = await executeAuditedCommand(database, {
      organizationId: metadata.organizationId,
      commandType: 'TransitionWorkItem',
      idempotencyKey: headers['idempotency-key'] ?? request.id,
      actorMemberId: headers['x-actor-member-id'] ?? metadata.accountableHumanId,
      source: headers['x-command-source'] ?? 'human',
      payload: { ...body, expectedEntityVersion: headers['if-match'] },
      entityType: 'work_item',
      entityId: id,
      workItemId: id,
      graphVersion: metadata.graphVersion,
      eventType: 'WorkItem.StateChanged',
      category: 'state_change',
      summary: `Work item changed to ${body.toStatus}`,
      details: { toStatus: body.toStatus },
      mutate: async (tx) => {
        const rows = await tx
        .select({
          id: schema.workItems.id,
          status: schema.workItems.status,
          graphNodeId: schema.workItems.graphNodeId,
          graphId: schema.graphNodes.graphId,
          graphVersion: schema.workGraphs.graphVersion,
          entityVersion: schema.workItems.entityVersion,
        })
        .from(schema.workItems)
        .innerJoin(schema.graphNodes, eq(schema.graphNodes.id, schema.workItems.graphNodeId))
        .innerJoin(schema.workGraphs, eq(schema.workGraphs.id, schema.graphNodes.graphId))
        .where(eq(schema.workItems.id, id))
        .limit(1);
        const item = rows[0];
        if (!item) throw new NotFoundError('WorkItem', id);
        if (item.graphVersion !== body.expectedGraphVersion) {
          throw new ConflictError(`Expected graph version ${body.expectedGraphVersion}, got ${item.graphVersion}`);
        }
        if (item.entityVersion !== headers['if-match']) {
          throw new OptimisticConcurrencyError(
            'work_item', id, headers['if-match'], item.entityVersion,
          );
        }

        const dependencies = await tx
        .select({ sourceNodeId: schema.workEdges.sourceNodeId })
        .from(schema.workEdges)
        .where(
          and(
            eq(schema.workEdges.targetNodeId, item.graphNodeId),
            eq(schema.workEdges.isHardDependency, true),
          ),
        );
        let dependenciesSatisfied = true;
        let dependencyWorkItemIds: readonly string[] = [];
        if (dependencies.length > 0) {
          const completed = await tx
            .select({
              id: schema.workItems.id,
              graphNodeId: schema.workItems.graphNodeId,
            })
          .from(schema.workItems)
          .where(
            and(
              inArray(schema.workItems.graphNodeId, dependencies.map((edge) => edge.sourceNodeId)),
              eq(schema.workItems.status, WorkItemStatus.Completed),
            ),
          );
          dependenciesSatisfied = completed.length === dependencies.length;
          dependencyWorkItemIds = completed.map((dependency) => dependency.id);
        }
        assertWorkItemTransition(item.status, body.toStatus, dependenciesSatisfied);

        if (body.toStatus === WorkItemStatus.Completed) {
          const gates = (await reviewRepository.listGatesForWorkItem(id)).filter(
            (gate) => gate.graphVersion === item.graphVersion,
          );
          const latestGate = gates.at(-1);
          if (latestGate) {
            await humanGatePolicy.assertReviewedWorkItemCanComplete({
              gateId: latestGate.id,
              workItemId: id,
              graphVersion: item.graphVersion,
            });
          }
        }

        if (body.toStatus === WorkItemStatus.Ready && dependencyWorkItemIds.length > 0) {
          const latestDependencyGates: HumanGate[] = [];
          for (const dependencyId of dependencyWorkItemIds) {
            const gates = (await reviewRepository.listGatesForWorkItem(dependencyId)).filter(
              (gate) => gate.graphVersion === item.graphVersion,
            );
            const latestGate = gates.at(-1);
            if (latestGate) latestDependencyGates.push(latestGate);
          }
          await humanGatePolicy.assertDownstreamCanBecomeReady(
            latestDependencyGates.map((gate) => gate.id),
          );
        }

        const [updated] = await tx
        .update(schema.workItems)
        .set({
          status: body.toStatus,
          entityVersion: item.entityVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.workItems.id, id),
            eq(schema.workItems.entityVersion, headers['if-match']),
          ),
        )
        .returning();
        if (!updated) {
          const current = await tx
            .select({ entityVersion: schema.workItems.entityVersion })
            .from(schema.workItems)
            .where(eq(schema.workItems.id, id))
            .limit(1);
          throw new OptimisticConcurrencyError(
            'work_item', id, headers['if-match'], current[0]?.entityVersion ?? item.entityVersion,
          );
        }

        const canceledDescendantWorkItemIds: string[] = [];
        if (body.toStatus === WorkItemStatus.Canceled) {
          const graphNodes = await tx
            .select({
              nodeId: schema.graphNodes.id,
              workItemId: schema.workItems.id,
              status: schema.workItems.status,
              entityVersion: schema.workItems.entityVersion,
            })
            .from(schema.graphNodes)
            .innerJoin(
              schema.workItems,
              eq(schema.workItems.graphNodeId, schema.graphNodes.id),
            )
            .where(eq(schema.graphNodes.graphId, item.graphId));
          const graphEdges = await tx
            .select({
              sourceNodeId: schema.workEdges.sourceNodeId,
              targetNodeId: schema.workEdges.targetNodeId,
            })
            .from(schema.workEdges)
            .where(
              and(
                eq(schema.workEdges.graphId, item.graphId),
                eq(schema.workEdges.isHardDependency, true),
              ),
            );
          const targetsBySource = new Map<string, string[]>();
          for (const edge of graphEdges) {
            targetsBySource.set(edge.sourceNodeId, [
              ...(targetsBySource.get(edge.sourceNodeId) ?? []),
              edge.targetNodeId,
            ]);
          }
          const descendantNodeIds = new Set<string>();
          const queue = [...(targetsBySource.get(item.graphNodeId) ?? [])];
          while (queue.length > 0) {
            const nodeId = queue.shift();
            if (!nodeId || descendantNodeIds.has(nodeId)) continue;
            descendantNodeIds.add(nodeId);
            queue.push(...(targetsBySource.get(nodeId) ?? []));
          }

          for (const descendant of graphNodes) {
            if (
              !descendantNodeIds.has(descendant.nodeId) ||
              descendant.status === WorkItemStatus.Completed ||
              descendant.status === WorkItemStatus.Canceled
            ) {
              continue;
            }
            const [canceled] = await tx
              .update(schema.workItems)
              .set({
                status: WorkItemStatus.Canceled,
                entityVersion: descendant.entityVersion + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(schema.workItems.id, descendant.workItemId),
                  eq(schema.workItems.entityVersion, descendant.entityVersion),
                ),
              )
              .returning({ id: schema.workItems.id });
            if (!canceled) {
              throw new OptimisticConcurrencyError(
                'work_item',
                descendant.workItemId,
                descendant.entityVersion,
                descendant.entityVersion + 1,
              );
            }
            canceledDescendantWorkItemIds.push(canceled.id);
          }
        }
        return {
          result: {
            ...updated,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
            canceledDescendantWorkItemIds,
          },
          entityVersion: updated.entityVersion,
        };
      },
    });
    return outcome.result;
  });

  done();
};
