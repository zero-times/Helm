import {
  ConflictError,
  NotFoundError,
  WorkItemStatus,
  assertWorkItemTransition,
} from '@helm/core-domain';
import { and, eq, inArray, type Database, schema } from '@helm/database';
import { HumanGatePolicy, type HumanGate } from '@helm/review';
import { PostgresReviewRepository } from '@helm/review/postgres';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

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
    validateDefinition(body);

    const graph = await database.transaction(async (tx) => {
      const existingRequirement = await tx
        .select({ id: schema.requirements.id })
        .from(schema.requirements)
        .where(eq(schema.requirements.id, requirementId))
        .limit(1);
      if (!existingRequirement[0]) throw new NotFoundError('Requirement', requirementId);

      const [createdGraph] = await tx
        .insert(schema.workGraphs)
        .values({ requirementId })
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
      return createdGraph;
    });

    void reply.code(201);
    return graph;
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

    return database.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: schema.workItems.id,
          status: schema.workItems.status,
          graphNodeId: schema.workItems.graphNodeId,
          graphId: schema.graphNodes.graphId,
          graphVersion: schema.workGraphs.graphVersion,
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
        .set({ status: body.toStatus, updatedAt: new Date() })
        .where(eq(schema.workItems.id, id))
        .returning();
      return updated;
    });
  });

  done();
};
