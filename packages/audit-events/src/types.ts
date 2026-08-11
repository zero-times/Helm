export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type TimelineImportance = "normal" | "important" | "critical";

export interface CommandEnvelope<TPayload extends JsonValue = JsonValue> {
  organizationId: string;
  commandType: string;
  idempotencyKey: string;
  actorMemberId: string;
  source: string;
  payload: TPayload;
  graphVersion?: number;
  policyDecisionId?: string;
}

export interface TimelineDescriptor {
  category: string;
  summary: string;
  details?: JsonObject;
  importance?: TimelineImportance;
}

export interface AuditEventDescriptor {
  eventType: string;
  payload?: JsonObject;
  workItemId?: string;
  executionId?: string;
  policyDecisionId?: string;
  timeline: TimelineDescriptor;
  outboxTopic?: string;
}

export interface AuditedEntity<TData extends JsonObject = JsonObject> {
  organizationId: string;
  entityType: string;
  entityId: string;
  version: number;
  data: TData;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAuditedEntityInput<TData extends JsonObject = JsonObject> {
  entityType: string;
  entityId: string;
  data: TData;
  event: AuditEventDescriptor;
}

export interface UpdateAuditedEntityInput<TData extends JsonObject = JsonObject> {
  entityType: string;
  entityId: string;
  expectedVersion: number;
  data: TData | ((current: Readonly<TData>) => TData);
  event: AuditEventDescriptor;
}

export interface DomainEvent {
  globalPosition: number;
  eventId: string;
  eventType: string;
  organizationId: string;
  entityType: string;
  entityId: string;
  workItemId?: string;
  executionId?: string;
  actorMemberId: string;
  source: string;
  graphVersion?: number;
  entityVersion: number;
  idempotencyKey: string;
  occurredAt: string;
  payload: JsonObject;
  policyDecisionId?: string;
}

export interface TimelineEvent {
  globalPosition: number;
  timelineEventId: string;
  domainEventId: string;
  organizationId: string;
  entityType: string;
  entityId: string;
  workItemId?: string;
  executionId?: string;
  category: string;
  summary: string;
  details: JsonObject;
  importance: TimelineImportance;
  actorMemberId: string;
  source: string;
  entityVersion: number;
  occurredAt: string;
}

export interface OutboxMessage {
  messageId: string;
  domainEventId: string;
  topic: string;
  payload: JsonObject;
  createdAt: string;
  publishedAt?: string;
  attempts: number;
  lastError?: string;
}

export interface IdempotencyRecord<TResult extends JsonValue = JsonValue> {
  organizationId: string;
  idempotencyKey: string;
  commandType: string;
  requestFingerprint: string;
  result: TResult;
  completedAt: string;
}

export interface CommandOutcome<TResult extends JsonValue = JsonValue> {
  idempotencyKey: string;
  replayed: boolean;
  result: TResult;
}

export interface EventQuery {
  organizationId: string;
  entityType?: string;
  entityId?: string;
  workItemId?: string;
  executionId?: string;
  eventTypes?: string[];
  afterPosition?: number;
  limit?: number;
}

export interface TimelineQuery {
  organizationId: string;
  entityType?: string;
  entityId?: string;
  workItemId?: string;
  executionId?: string;
  categories?: string[];
  minimumImportance?: TimelineImportance;
  afterPosition?: number;
  limit?: number;
}
