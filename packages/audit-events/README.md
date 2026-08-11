# `@helm/audit-events`

Phase 0 reliability primitives for audited command handling. The package has no
runtime dependencies and can be merged before the Work Graph, Execution, and
Review modules are complete.

## Guarantees

- An `(organizationId, idempotencyKey)` identifies one command type and payload.
  Exact retries replay the stored result; key reuse with different input fails.
- Every audited entity mutation checks or advances `entity_version`.
- Entity state, the idempotency result, one append-only domain event, one timeline
  projection, and one outbox message commit atomically.
- Timeline and domain-event queries use monotonic positions for deterministic
  pagination.
- Outbox publication and failure recording are retry-safe; domain and timeline
  history never expose mutable internal records.

## Usage

```ts
import {
  AuditCommandExecutor,
  InMemoryAuditStore,
} from "@helm/audit-events";

const store = new InMemoryAuditStore();
const commands = new AuditCommandExecutor(store);

const outcome = await commands.execute(
  {
    organizationId: "org-1",
    commandType: "MoveWorkItem",
    idempotencyKey: "request-42",
    actorMemberId: "human-1",
    source: "human",
    graphVersion: 3,
    payload: { workItemId: "work-1", nextState: "ready" },
  },
  (tx) => {
    const workItem = tx.updateAuditedEntity({
      entityType: "work_item",
      entityId: "work-1",
      expectedVersion: 4,
      data: { state: "ready" },
      event: {
        eventType: "WorkItem.StateChanged",
        workItemId: "work-1",
        payload: { state: "ready" },
        timeline: {
          category: "state_change",
          summary: "Work item became ready",
        },
      },
    });
    return { workItemId: workItem.entityId, version: workItem.version };
  },
);
```

Use `InMemoryAuditStore` for domain development and deterministic tests. Apply
[`migrations/0001_audit_events.sql`](migrations/0001_audit_events.sql) when the
PostgreSQL foundation is available. Production repositories must follow the
transaction sequence in [`docs/postgres-integration.md`](docs/postgres-integration.md).
`AuditCommandExecutor` depends on the generic `AtomicCommandStore<TTransaction>`
port, so the PostgreSQL adapter can pass its own database transaction to domain
handlers without coupling command code to the in-memory implementation.

## Verification

```sh
cd packages/audit-events
npm test
npm run typecheck
```
