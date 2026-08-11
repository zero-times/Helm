import { randomUUID } from "node:crypto";

import {
  EntityAlreadyExistsError,
  EntityNotFoundError,
  IdempotencyConflictError,
  InvalidAuditInputError,
  OptimisticConcurrencyError,
  OutboxMessageNotFoundError,
} from "./errors.ts";
import { assertJsonValue } from "./stable-json.ts";
import type {
  AuditEventDescriptor,
  AuditedEntity,
  CommandEnvelope,
  CommandOutcome,
  CreateAuditedEntityInput,
  DomainEvent,
  EventQuery,
  IdempotencyRecord,
  JsonObject,
  JsonValue,
  OutboxMessage,
  TimelineEvent,
  TimelineImportance,
  TimelineQuery,
  UpdateAuditedEntityInput,
} from "./types.ts";

interface StoreState {
  entities: Map<string, AuditedEntity>;
  idempotencyRecords: Map<string, IdempotencyRecord>;
  domainEvents: DomainEvent[];
  timelineEvents: TimelineEvent[];
  outboxMessages: Map<string, OutboxMessage>;
  nextDomainPosition: number;
  nextTimelinePosition: number;
}

export interface InMemoryAuditStoreOptions {
  clock?: () => Date;
  idFactory?: () => string;
}

const importanceRank: Record<TimelineImportance, number> = {
  normal: 0,
  important: 1,
  critical: 2,
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cloneState(state: StoreState): StoreState {
  return {
    entities: new Map(
      [...state.entities.entries()].map(([key, value]) => [key, clone(value)]),
    ),
    idempotencyRecords: new Map(
      [...state.idempotencyRecords.entries()].map(([key, value]) => [
        key,
        clone(value),
      ]),
    ),
    domainEvents: clone(state.domainEvents),
    timelineEvents: clone(state.timelineEvents),
    outboxMessages: new Map(
      [...state.outboxMessages.entries()].map(([key, value]) => [key, clone(value)]),
    ),
    nextDomainPosition: state.nextDomainPosition,
    nextTimelinePosition: state.nextTimelinePosition,
  };
}

function requireText(value: string, label: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidAuditInputError(`${label} is required.`);
  }
}

function entityKey(organizationId: string, entityType: string, entityId: string): string {
  return JSON.stringify([organizationId, entityType, entityId]);
}

function idempotencyKey(organizationId: string, key: string): string {
  return JSON.stringify([organizationId, key]);
}

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) return 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new InvalidAuditInputError("limit must be an integer between 1 and 500.");
  }
  return limit;
}

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<TResult>(work: () => Promise<TResult>): Promise<TResult> {
    const previous = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}

export class AuditTransaction {
  private readonly state: StoreState;
  private readonly command: CommandEnvelope;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;

  constructor(
    state: StoreState,
    command: CommandEnvelope,
    clock: () => Date,
    idFactory: () => string,
  ) {
    this.state = state;
    this.command = command;
    this.clock = clock;
    this.idFactory = idFactory;
  }

  getEntity<TData extends JsonObject = JsonObject>(
    entityType: string,
    entityId: string,
  ): AuditedEntity<TData> | undefined {
    requireText(entityType, "entityType");
    requireText(entityId, "entityId");
    const entity = this.state.entities.get(
      entityKey(this.command.organizationId, entityType, entityId),
    );
    return entity ? (clone(entity) as AuditedEntity<TData>) : undefined;
  }

  createAuditedEntity<TData extends JsonObject>(
    input: CreateAuditedEntityInput<TData>,
  ): AuditedEntity<TData> {
    this.validateEntityInput(input.entityType, input.entityId, input.data, input.event);
    const key = entityKey(
      this.command.organizationId,
      input.entityType,
      input.entityId,
    );
    if (this.state.entities.has(key)) {
      throw new EntityAlreadyExistsError(input.entityType, input.entityId);
    }

    const now = this.clock().toISOString();
    const entity: AuditedEntity<TData> = {
      organizationId: this.command.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      version: 1,
      data: clone(input.data),
      createdAt: now,
      updatedAt: now,
    };
    this.state.entities.set(key, clone(entity));
    this.appendEvent(entity, input.event, now);
    return clone(entity);
  }

  updateAuditedEntity<TData extends JsonObject>(
    input: UpdateAuditedEntityInput<TData>,
  ): AuditedEntity<TData> {
    requireText(input.entityType, "entityType");
    requireText(input.entityId, "entityId");
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new InvalidAuditInputError("expectedVersion must be a positive integer.");
    }

    const key = entityKey(
      this.command.organizationId,
      input.entityType,
      input.entityId,
    );
    const current = this.state.entities.get(key) as AuditedEntity<TData> | undefined;
    if (!current) {
      throw new EntityNotFoundError(input.entityType, input.entityId);
    }
    if (current.version !== input.expectedVersion) {
      throw new OptimisticConcurrencyError(
        input.entityType,
        input.entityId,
        input.expectedVersion,
        current.version,
      );
    }

    const nextData =
      typeof input.data === "function"
        ? input.data(clone(current.data))
        : input.data;
    this.validateEntityInput(input.entityType, input.entityId, nextData, input.event);

    const now = this.clock().toISOString();
    const entity: AuditedEntity<TData> = {
      ...clone(current),
      version: current.version + 1,
      data: clone(nextData),
      updatedAt: now,
    };
    this.state.entities.set(key, clone(entity));
    this.appendEvent(entity, input.event, now);
    return clone(entity);
  }

  private validateEntityInput(
    entityType: string,
    entityId: string,
    data: JsonObject,
    event: AuditEventDescriptor,
  ): void {
    requireText(entityType, "entityType");
    requireText(entityId, "entityId");
    requireText(event.eventType, "event.eventType");
    requireText(event.timeline.category, "event.timeline.category");
    requireText(event.timeline.summary, "event.timeline.summary");
    if (event.workItemId !== undefined) {
      requireText(event.workItemId, "event.workItemId");
    }
    if (event.executionId !== undefined) {
      requireText(event.executionId, "event.executionId");
    }
    if (event.policyDecisionId !== undefined) {
      requireText(event.policyDecisionId, "event.policyDecisionId");
    }
    if (event.outboxTopic !== undefined) {
      requireText(event.outboxTopic, "event.outboxTopic");
    }
    if (
      event.timeline.importance !== undefined &&
      !(event.timeline.importance in importanceRank)
    ) {
      throw new InvalidAuditInputError(
        "event.timeline.importance must be normal, important, or critical.",
      );
    }
    assertJsonValue(data, "data");
    assertJsonValue(event.payload ?? {}, "event.payload");
    assertJsonValue(event.timeline.details ?? {}, "event.timeline.details");
  }

  private appendEvent(
    entity: AuditedEntity,
    descriptor: AuditEventDescriptor,
    occurredAt: string,
  ): void {
    const eventId = this.idFactory();
    const event: DomainEvent = {
      globalPosition: this.state.nextDomainPosition++,
      eventId,
      eventType: descriptor.eventType,
      organizationId: this.command.organizationId,
      entityType: entity.entityType,
      entityId: entity.entityId,
      ...(descriptor.workItemId ? { workItemId: descriptor.workItemId } : {}),
      ...(descriptor.executionId ? { executionId: descriptor.executionId } : {}),
      actorMemberId: this.command.actorMemberId,
      source: this.command.source,
      ...(this.command.graphVersion !== undefined
        ? { graphVersion: this.command.graphVersion }
        : {}),
      entityVersion: entity.version,
      idempotencyKey: this.command.idempotencyKey,
      occurredAt,
      payload: clone(descriptor.payload ?? {}),
      ...(descriptor.policyDecisionId ?? this.command.policyDecisionId
        ? {
            policyDecisionId:
              descriptor.policyDecisionId ?? this.command.policyDecisionId,
          }
        : {}),
    };
    this.state.domainEvents.push(event);

    const timeline: TimelineEvent = {
      globalPosition: this.state.nextTimelinePosition++,
      timelineEventId: this.idFactory(),
      domainEventId: eventId,
      organizationId: event.organizationId,
      entityType: event.entityType,
      entityId: event.entityId,
      ...(event.workItemId ? { workItemId: event.workItemId } : {}),
      ...(event.executionId ? { executionId: event.executionId } : {}),
      category: descriptor.timeline.category,
      summary: descriptor.timeline.summary,
      details: clone(descriptor.timeline.details ?? {}),
      importance: descriptor.timeline.importance ?? "normal",
      actorMemberId: event.actorMemberId,
      source: event.source,
      entityVersion: event.entityVersion,
      occurredAt,
    };
    this.state.timelineEvents.push(timeline);

    const message: OutboxMessage = {
      messageId: this.idFactory(),
      domainEventId: eventId,
      topic: descriptor.outboxTopic ?? `domain.${descriptor.eventType}`,
      payload: {
        eventId,
        eventType: event.eventType,
        organizationId: event.organizationId,
        entityType: event.entityType,
        entityId: event.entityId,
        entityVersion: event.entityVersion,
        occurredAt: event.occurredAt,
        payload: clone(event.payload),
      },
      createdAt: occurredAt,
      attempts: 0,
    };
    this.state.outboxMessages.set(message.messageId, message);
  }
}

export class InMemoryAuditStore {
  private state: StoreState = {
    entities: new Map(),
    idempotencyRecords: new Map(),
    domainEvents: [],
    timelineEvents: [],
    outboxMessages: new Map(),
    nextDomainPosition: 1,
    nextTimelinePosition: 1,
  };

  private readonly mutex = new AsyncMutex();
  private readonly clock: () => Date;
  private readonly idFactory: () => string;

  constructor(options: InMemoryAuditStoreOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async executeCommand<TResult extends JsonValue>(
    command: CommandEnvelope,
    requestFingerprint: string,
    handler: (transaction: AuditTransaction) => Promise<TResult> | TResult,
  ): Promise<CommandOutcome<TResult>> {
    return this.mutex.runExclusive(async () => {
      const draft = cloneState(this.state);
      const key = idempotencyKey(command.organizationId, command.idempotencyKey);
      const existing = draft.idempotencyRecords.get(key);
      if (existing) {
        if (
          existing.commandType !== command.commandType ||
          existing.requestFingerprint !== requestFingerprint
        ) {
          throw new IdempotencyConflictError(command.idempotencyKey);
        }
        return {
          idempotencyKey: command.idempotencyKey,
          replayed: true,
          result: clone(existing.result) as TResult,
        };
      }

      const transaction = new AuditTransaction(
        draft,
        command,
        this.clock,
        this.idFactory,
      );
      const result = await handler(transaction);
      assertJsonValue(result, "command result");

      draft.idempotencyRecords.set(key, {
        organizationId: command.organizationId,
        idempotencyKey: command.idempotencyKey,
        commandType: command.commandType,
        requestFingerprint,
        result: clone(result),
        completedAt: this.clock().toISOString(),
      });
      this.state = draft;

      return {
        idempotencyKey: command.idempotencyKey,
        replayed: false,
        result: clone(result),
      };
    });
  }

  getEntity<TData extends JsonObject = JsonObject>(
    organizationId: string,
    entityType: string,
    entityId: string,
  ): AuditedEntity<TData> | undefined {
    const entity = this.state.entities.get(
      entityKey(organizationId, entityType, entityId),
    );
    return entity ? (clone(entity) as AuditedEntity<TData>) : undefined;
  }

  getIdempotencyRecord(
    organizationId: string,
    key: string,
  ): IdempotencyRecord | undefined {
    const record = this.state.idempotencyRecords.get(
      idempotencyKey(organizationId, key),
    );
    return record ? clone(record) : undefined;
  }

  queryDomainEvents(query: EventQuery): DomainEvent[] {
    requireText(query.organizationId, "organizationId");
    const limit = boundedLimit(query.limit);
    return this.state.domainEvents
      .filter((event) => event.organizationId === query.organizationId)
      .filter((event) => !query.entityType || event.entityType === query.entityType)
      .filter((event) => !query.entityId || event.entityId === query.entityId)
      .filter((event) => !query.workItemId || event.workItemId === query.workItemId)
      .filter(
        (event) => !query.executionId || event.executionId === query.executionId,
      )
      .filter(
        (event) =>
          !query.eventTypes?.length || query.eventTypes.includes(event.eventType),
      )
      .filter(
        (event) =>
          query.afterPosition === undefined ||
          event.globalPosition > query.afterPosition,
      )
      .slice(0, limit)
      .map(clone);
  }

  queryTimeline(query: TimelineQuery): TimelineEvent[] {
    requireText(query.organizationId, "organizationId");
    const limit = boundedLimit(query.limit);
    if (
      query.minimumImportance !== undefined &&
      !(query.minimumImportance in importanceRank)
    ) {
      throw new InvalidAuditInputError(
        "minimumImportance must be normal, important, or critical.",
      );
    }
    const minimumImportance = query.minimumImportance
      ? importanceRank[query.minimumImportance]
      : 0;

    return this.state.timelineEvents
      .filter((event) => event.organizationId === query.organizationId)
      .filter((event) => !query.entityType || event.entityType === query.entityType)
      .filter((event) => !query.entityId || event.entityId === query.entityId)
      .filter((event) => !query.workItemId || event.workItemId === query.workItemId)
      .filter(
        (event) => !query.executionId || event.executionId === query.executionId,
      )
      .filter(
        (event) =>
          !query.categories?.length || query.categories.includes(event.category),
      )
      .filter((event) => importanceRank[event.importance] >= minimumImportance)
      .filter(
        (event) =>
          query.afterPosition === undefined ||
          event.globalPosition > query.afterPosition,
      )
      .slice(0, limit)
      .map(clone);
  }

  listPendingOutbox(limit = 100): OutboxMessage[] {
    const bounded = boundedLimit(limit);
    return [...this.state.outboxMessages.values()]
      .filter((message) => !message.publishedAt)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, bounded)
      .map(clone);
  }

  async recordOutboxFailure(messageId: string, error: string): Promise<OutboxMessage> {
    requireText(error, "error");
    return this.mutex.runExclusive(async () => {
      const draft = cloneState(this.state);
      const message = draft.outboxMessages.get(messageId);
      if (!message) throw new OutboxMessageNotFoundError(messageId);
      if (!message.publishedAt) {
        message.attempts += 1;
        message.lastError = error;
      }
      this.state = draft;
      return clone(message);
    });
  }

  async markOutboxPublished(
    messageId: string,
    publishedAt = this.clock(),
  ): Promise<OutboxMessage> {
    return this.mutex.runExclusive(async () => {
      const draft = cloneState(this.state);
      const message = draft.outboxMessages.get(messageId);
      if (!message) throw new OutboxMessageNotFoundError(messageId);
      if (!message.publishedAt) {
        message.publishedAt = publishedAt.toISOString();
        message.attempts += 1;
        delete message.lastError;
      }
      this.state = draft;
      return clone(message);
    });
  }
}
