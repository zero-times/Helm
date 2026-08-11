import type {
  DomainEvent,
  EventQuery,
  OutboxMessage,
  TimelineEvent,
  TimelineQuery,
} from "./types.ts";

export interface AuditReadStore {
  queryDomainEvents(query: EventQuery): DomainEvent[];
  queryTimeline(query: TimelineQuery): TimelineEvent[];
  listPendingOutbox(limit?: number): OutboxMessage[];
}

export class AuditQueryService {
  private readonly store: AuditReadStore;

  constructor(store: AuditReadStore) {
    this.store = store;
  }

  domainEvents(query: EventQuery): DomainEvent[] {
    return this.store.queryDomainEvents(query);
  }

  timeline(query: TimelineQuery): TimelineEvent[] {
    return this.store.queryTimeline(query);
  }

  pendingOutbox(limit = 100): OutboxMessage[] {
    return this.store.listPendingOutbox(limit);
  }
}
