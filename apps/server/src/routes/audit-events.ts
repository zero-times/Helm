import { sql, type Database } from '@helm/database';
import type { FastifyPluginCallback } from 'fastify';
import { z } from 'zod';

const querySchema = z.object({
  organizationId: z.string().uuid(),
  entityType: z.string().trim().min(1).optional(),
  entityId: z.string().trim().min(1).optional(),
  workItemId: z.string().uuid().optional(),
  executionId: z.string().uuid().optional(),
  afterPosition: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(250).default(100),
});

export interface AuditEventRoutesOptions {
  database: Database;
}

interface TimelineRow {
  global_position: string | number;
  timeline_event_id: string;
  domain_event_id: string;
  organization_id: string;
  entity_type: string;
  entity_id: string;
  work_item_id: string | null;
  execution_id: string | null;
  category: string;
  summary: string;
  details: Record<string, unknown>;
  importance: 'normal' | 'important' | 'critical';
  actor_member_id: string;
  source: string;
  entity_version: string | number;
  occurred_at: Date | string;
}

interface DomainEventRow {
  global_position: string | number;
  event_id: string;
  event_type: string;
  organization_id: string;
  entity_type: string;
  entity_id: string;
  work_item_id: string | null;
  execution_id: string | null;
  actor_member_id: string;
  source: string;
  graph_version: string | number | null;
  entity_version: string | number;
  idempotency_key: string;
  occurred_at: Date | string;
  payload: Record<string, unknown>;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function timelineEvent(row: TimelineRow) {
  return {
    globalPosition: Number(row.global_position),
    timelineEventId: row.timeline_event_id,
    domainEventId: row.domain_event_id,
    organizationId: row.organization_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    workItemId: row.work_item_id ?? undefined,
    executionId: row.execution_id ?? undefined,
    category: row.category,
    summary: row.summary,
    details: row.details,
    importance: row.importance,
    actorMemberId: row.actor_member_id,
    source: row.source,
    entityVersion: Number(row.entity_version),
    occurredAt: iso(row.occurred_at),
  };
}

function domainEvent(row: DomainEventRow) {
  return {
    globalPosition: Number(row.global_position),
    eventId: row.event_id,
    eventType: row.event_type,
    organizationId: row.organization_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    workItemId: row.work_item_id ?? undefined,
    executionId: row.execution_id ?? undefined,
    actorMemberId: row.actor_member_id,
    source: row.source,
    graphVersion: row.graph_version === null ? undefined : Number(row.graph_version),
    entityVersion: Number(row.entity_version),
    idempotencyKey: row.idempotency_key,
    occurredAt: iso(row.occurred_at),
    payload: row.payload,
  };
}

async function readTimeline(database: Database, query: z.infer<typeof querySchema>) {
  const rows = await database.execute(sql`
    SELECT * FROM timeline_events
    WHERE organization_id = ${query.organizationId}
      AND global_position > ${query.afterPosition}
      AND (${query.entityType ?? null}::text IS NULL OR entity_type = ${query.entityType ?? null})
      AND (${query.entityId ?? null}::text IS NULL OR entity_id = ${query.entityId ?? null})
      AND (${query.workItemId ?? null}::text IS NULL OR work_item_id = ${query.workItemId ?? null})
      AND (${query.executionId ?? null}::text IS NULL OR execution_id = ${query.executionId ?? null})
    ORDER BY global_position
    LIMIT ${query.limit}
  `);
  return Array.from(rows, (row) => timelineEvent(row as unknown as TimelineRow));
}

export const auditEventRoutes: FastifyPluginCallback<AuditEventRoutesOptions> = (
  server,
  options,
  done,
) => {
  server.get('/api/v1/timeline', async (request) => {
    const query = querySchema.parse(request.query);
    const events = await readTimeline(options.database, query);
    return { events, nextPosition: events.at(-1)?.globalPosition ?? query.afterPosition };
  });

  server.get('/api/v1/domain-events', async (request) => {
    const query = querySchema.parse(request.query);
    const rows = await options.database.execute(sql`
      SELECT * FROM domain_events
      WHERE organization_id = ${query.organizationId}
        AND global_position > ${query.afterPosition}
        AND (${query.entityType ?? null}::text IS NULL OR entity_type = ${query.entityType ?? null})
        AND (${query.entityId ?? null}::text IS NULL OR entity_id = ${query.entityId ?? null})
        AND (${query.workItemId ?? null}::text IS NULL OR work_item_id = ${query.workItemId ?? null})
        AND (${query.executionId ?? null}::text IS NULL OR execution_id = ${query.executionId ?? null})
      ORDER BY global_position
      LIMIT ${query.limit}
    `);
    const events = Array.from(
      rows,
      (row) => domainEvent(row as unknown as DomainEventRow),
    );
    return { events, nextPosition: events.at(-1)?.globalPosition ?? query.afterPosition };
  });

  server.get('/api/v1/events', async (request, reply) => {
    const parsed = querySchema.parse(request.query);
    const headerPosition = Number(request.headers['last-event-id'] ?? 0);
    let afterPosition = Number.isSafeInteger(headerPosition) && headerPosition >= 0
      ? Math.max(parsed.afterPosition, headerPosition)
      : parsed.afterPosition;
    let polling = false;

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 2000\n\n');

    const poll = async (): Promise<void> => {
      if (polling || reply.raw.destroyed) return;
      polling = true;
      try {
        const events = await readTimeline(options.database, { ...parsed, afterPosition });
        for (const event of events) {
          afterPosition = event.globalPosition;
          reply.raw.write(`id: ${event.globalPosition}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        if (events.length === 0) reply.raw.write(': keep-alive\n\n');
      } catch (error) {
        request.log.error({ err: error }, 'Timeline SSE poll failed');
      } finally {
        polling = false;
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), 2_000);
    request.raw.once('close', () => clearInterval(timer));
  });

  done();
};
