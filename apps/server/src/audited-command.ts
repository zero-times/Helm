import { randomUUID } from 'node:crypto';

import {
  IdempotencyConflictError,
  commandFingerprint,
  type CommandOutcome,
  type JsonObject,
  type JsonValue,
  type TimelineImportance,
} from '@helm/audit-events';
import { sql, type Database } from '@helm/database';

type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface AuditedCommand<TResult extends JsonValue> {
  organizationId: string;
  commandType: string;
  idempotencyKey: string;
  actorMemberId: string;
  source: string;
  payload: JsonValue;
  entityType: string;
  entityId: string;
  eventType: string;
  workItemId?: string;
  executionId?: string;
  graphVersion?: number;
  category: string;
  summary: string;
  details?: JsonObject;
  importance?: TimelineImportance;
  outboxTopic?: string;
  mutate: (transaction: DatabaseTransaction) => Promise<{
    result: TResult;
    entityVersion: number;
  }>;
}

interface StoredIdempotencyRow {
  command_type: string;
  request_fingerprint: string;
  status: string;
  result_json: JsonValue | null;
}

export async function executeAuditedCommand<TResult extends JsonValue>(
  database: Database,
  command: AuditedCommand<TResult>,
): Promise<CommandOutcome<TResult>> {
  const fingerprint = commandFingerprint(command.commandType, command.payload);

  return database.transaction(async (transaction) => {
    const reserved = await transaction.execute(sql`
      INSERT INTO idempotency_keys (
        organization_id, idempotency_key, command_type, request_fingerprint, status
      ) VALUES (
        ${command.organizationId}, ${command.idempotencyKey}, ${command.commandType},
        ${fingerprint}, 'processing'
      )
      ON CONFLICT (organization_id, idempotency_key) DO NOTHING
      RETURNING idempotency_key
    `);

    if (reserved.length === 0) {
      const existing = await transaction.execute(sql`
        SELECT command_type, request_fingerprint, status, result_json
        FROM idempotency_keys
        WHERE organization_id = ${command.organizationId}
          AND idempotency_key = ${command.idempotencyKey}
        FOR UPDATE
      `);
      const row = existing[0] as StoredIdempotencyRow | undefined;
      if (
        row === undefined ||
        row.command_type !== command.commandType ||
        row.request_fingerprint !== fingerprint ||
        row.status !== 'completed' ||
        row.result_json === null
      ) {
        throw new IdempotencyConflictError(command.idempotencyKey);
      }
      return {
        idempotencyKey: command.idempotencyKey,
        replayed: true,
        result: row.result_json as TResult,
      };
    }

    const mutation = await command.mutate(transaction);
    const occurredAt = new Date().toISOString();
    const eventId = randomUUID();
    const timelineEventId = randomUUID();
    const messageId = randomUUID();
    const payloadJson = JSON.stringify(command.payload);
    const detailsJson = JSON.stringify(command.details ?? {});
    const resultJson = JSON.stringify(mutation.result);

    await transaction.execute(sql`
      INSERT INTO entity_versions (
        organization_id, entity_type, entity_id, entity_version, updated_at
      ) VALUES (
        ${command.organizationId}, ${command.entityType}, ${command.entityId},
        ${mutation.entityVersion}, ${occurredAt}
      )
      ON CONFLICT (organization_id, entity_type, entity_id)
      DO UPDATE SET entity_version = EXCLUDED.entity_version, updated_at = EXCLUDED.updated_at
    `);
    await transaction.execute(sql`
      INSERT INTO domain_events (
        event_id, event_type, organization_id, entity_type, entity_id,
        work_item_id, execution_id, actor_member_id, source, graph_version,
        entity_version, idempotency_key, occurred_at, payload
      ) VALUES (
        ${eventId}, ${command.eventType}, ${command.organizationId},
        ${command.entityType}, ${command.entityId}, ${command.workItemId ?? null},
        ${command.executionId ?? null}, ${command.actorMemberId}, ${command.source},
        ${command.graphVersion ?? null}, ${mutation.entityVersion},
        ${command.idempotencyKey}, ${occurredAt}, ${payloadJson}::jsonb
      )
    `);
    await transaction.execute(sql`
      INSERT INTO timeline_events (
        timeline_event_id, domain_event_id, organization_id, entity_type, entity_id,
        work_item_id, execution_id, category, summary, details, importance,
        actor_member_id, source, entity_version, occurred_at
      ) VALUES (
        ${timelineEventId}, ${eventId}, ${command.organizationId},
        ${command.entityType}, ${command.entityId}, ${command.workItemId ?? null},
        ${command.executionId ?? null}, ${command.category}, ${command.summary},
        ${detailsJson}::jsonb, ${command.importance ?? 'normal'},
        ${command.actorMemberId}, ${command.source}, ${mutation.entityVersion}, ${occurredAt}
      )
    `);
    await transaction.execute(sql`
      INSERT INTO outbox_messages (
        message_id, domain_event_id, topic, payload, created_at
      ) VALUES (
        ${messageId}, ${eventId}, ${command.outboxTopic ?? command.eventType},
        ${payloadJson}::jsonb, ${occurredAt}
      )
    `);
    await transaction.execute(sql`
      UPDATE idempotency_keys
      SET status = 'completed', result_json = ${resultJson}::jsonb, completed_at = ${occurredAt}
      WHERE organization_id = ${command.organizationId}
        AND idempotency_key = ${command.idempotencyKey}
    `);

    return {
      idempotencyKey: command.idempotencyKey,
      replayed: false,
      result: mutation.result,
    };
  });
}
