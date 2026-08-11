import assert from "node:assert/strict";
import test from "node:test";

import {
  AuditCommandExecutor,
  AuditQueryService,
  IdempotencyConflictError,
  InMemoryAuditStore,
  OptimisticConcurrencyError,
} from "../src/index.ts";

const organizationId = "org-1";
const actorMemberId = "human-1";

function command(
  idempotencyKey: string,
  commandType: string,
  payload: Record<string, string | number>,
) {
  return {
    organizationId,
    actorMemberId,
    source: "human",
    graphVersion: 3,
    idempotencyKey,
    commandType,
    payload,
  };
}

function createdEvent(summary = "Work item created") {
  return {
    eventType: "WorkItem.Created",
    workItemId: "work-1",
    payload: { state: "draft" },
    timeline: {
      category: "state_change",
      summary,
      importance: "important" as const,
    },
  };
}

test("a repeated command replays its result without duplicating state or events", async () => {
  const store = new InMemoryAuditStore();
  const executor = new AuditCommandExecutor(store);
  let calls = 0;

  const create = () =>
    executor.execute(command("create-work-1", "CreateWorkItem", { id: "work-1" }), (tx) => {
      calls += 1;
      const entity = tx.createAuditedEntity({
        entityType: "work_item",
        entityId: "work-1",
        data: { state: "draft", title: "Audit events" },
        event: createdEvent(),
      });
      return { entityId: entity.entityId, version: entity.version };
    });

  const [first, replay] = await Promise.all([create(), create()]);

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.result, first.result);
  assert.equal(calls, 1);
  assert.equal(store.queryDomainEvents({ organizationId }).length, 1);
  assert.equal(store.queryTimeline({ organizationId }).length, 1);
  assert.equal(store.listPendingOutbox().length, 1);
});

test("an idempotency key cannot be reused for a different payload", async () => {
  const store = new InMemoryAuditStore();
  const executor = new AuditCommandExecutor(store);

  await executor.execute(command("shared-key", "CreateWorkItem", { id: "work-1" }), (tx) => {
    tx.createAuditedEntity({
      entityType: "work_item",
      entityId: "work-1",
      data: { state: "draft" },
      event: createdEvent(),
    });
    return { ok: true };
  });

  await assert.rejects(
    executor.execute(command("shared-key", "CreateWorkItem", { id: "work-2" }), () => ({
      ok: true,
    })),
    IdempotencyConflictError,
  );
});

test("two writers using the same entity version produce one explicit conflict", async () => {
  const store = new InMemoryAuditStore();
  const executor = new AuditCommandExecutor(store);

  await executor.execute(command("create", "CreateWorkItem", { id: "work-1" }), (tx) => {
    tx.createAuditedEntity({
      entityType: "work_item",
      entityId: "work-1",
      data: { state: "draft" },
      event: createdEvent(),
    });
    return { ok: true };
  });

  const update = (key: string, state: string) =>
    executor.execute(command(key, "MoveWorkItem", { state }), (tx) => {
      const entity = tx.updateAuditedEntity({
        entityType: "work_item",
        entityId: "work-1",
        expectedVersion: 1,
        data: { state },
        event: {
          eventType: "WorkItem.StateChanged",
          workItemId: "work-1",
          payload: { state },
          timeline: { category: "state_change", summary: `Moved to ${state}` },
        },
      });
      return { version: entity.version, state };
    });

  const outcomes = await Promise.allSettled([
    update("ready", "ready"),
    update("cancel", "cancelled"),
  ]);
  const successes = outcomes.filter((outcome) => outcome.status === "fulfilled");
  const failures = outcomes.filter((outcome) => outcome.status === "rejected");

  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  const failure = failures[0]!;
  assert.equal(failure.status, "rejected");
  if (failure.status === "rejected") {
    assert.ok(failure.reason instanceof OptimisticConcurrencyError);
    assert.equal(failure.reason.code, "OPTIMISTIC_CONCURRENCY_CONFLICT");
    assert.equal(failure.reason.expectedVersion, 1);
    assert.equal(failure.reason.actualVersion, 2);
  }
  assert.equal(store.getEntity(organizationId, "work_item", "work-1")?.version, 2);
  assert.equal(store.queryDomainEvents({ organizationId }).length, 2);
});

test("a failed command rolls back entity, audit, timeline, outbox, and idempotency writes", async () => {
  const store = new InMemoryAuditStore();
  const executor = new AuditCommandExecutor(store);

  await assert.rejects(
    executor.execute(command("will-rollback", "CreateWorkItem", { id: "work-1" }), (tx) => {
      tx.createAuditedEntity({
        entityType: "work_item",
        entityId: "work-1",
        data: { state: "draft" },
        event: createdEvent(),
      });
      throw new Error("simulated business failure");
    }),
    /simulated business failure/,
  );

  assert.equal(store.getEntity(organizationId, "work_item", "work-1"), undefined);
  assert.equal(store.getIdempotencyRecord(organizationId, "will-rollback"), undefined);
  assert.deepEqual(store.queryDomainEvents({ organizationId }), []);
  assert.deepEqual(store.queryTimeline({ organizationId }), []);
  assert.deepEqual(store.listPendingOutbox(), []);
});

test("the timeline reconstructs ordered state changes with actor and version context", async () => {
  const store = new InMemoryAuditStore();
  const executor = new AuditCommandExecutor(store);
  const query = new AuditQueryService(store);

  await executor.execute(command("create", "CreateWorkItem", { id: "work-1" }), (tx) => {
    tx.createAuditedEntity({
      entityType: "work_item",
      entityId: "work-1",
      data: { state: "draft" },
      event: createdEvent(),
    });
    return { version: 1 };
  });

  for (const [version, state] of [
    [1, "ready"],
    [2, "running"],
  ] as const) {
    await executor.execute(command(`move-${state}`, "MoveWorkItem", { state }), (tx) => {
      const entity = tx.updateAuditedEntity({
        entityType: "work_item",
        entityId: "work-1",
        expectedVersion: version,
        data: { state },
        event: {
          eventType: "WorkItem.StateChanged",
          workItemId: "work-1",
          payload: { fromVersion: version, state },
          timeline: {
            category: "state_change",
            summary: `Work item moved to ${state}`,
            importance: state === "running" ? "important" : "normal",
          },
        },
      });
      return { version: entity.version };
    });
  }

  const timeline = query.timeline({
    organizationId,
    workItemId: "work-1",
  });
  assert.deepEqual(
    timeline.map((event) => [event.entityVersion, event.summary]),
    [
      [1, "Work item created"],
      [2, "Work item moved to ready"],
      [3, "Work item moved to running"],
    ],
  );
  assert.ok(timeline.every((event) => event.actorMemberId === actorMemberId));
  assert.ok(timeline.every((event) => event.source === "human"));

  const important = query.timeline({
    organizationId,
    workItemId: "work-1",
    minimumImportance: "important",
  });
  assert.deepEqual(
    important.map((event) => event.entityVersion),
    [1, 3],
  );
});

test("event queries support type filters and position-based pagination", async () => {
  const store = new InMemoryAuditStore();
  const executor = new AuditCommandExecutor(store);
  const query = new AuditQueryService(store);

  await executor.execute(command("create", "CreateWorkItem", { id: "work-1" }), (tx) => {
    tx.createAuditedEntity({
      entityType: "work_item",
      entityId: "work-1",
      data: { state: "draft" },
      event: createdEvent(),
    });
    return { ok: true };
  });
  await executor.execute(command("ready", "MoveWorkItem", { state: "ready" }), (tx) => {
    tx.updateAuditedEntity({
      entityType: "work_item",
      entityId: "work-1",
      expectedVersion: 1,
      data: { state: "ready" },
      event: {
        eventType: "WorkItem.StateChanged",
        workItemId: "work-1",
        timeline: { category: "state_change", summary: "Ready" },
      },
    });
    return { ok: true };
  });

  const firstPage = query.domainEvents({ organizationId, limit: 1 });
  const secondPage = query.domainEvents({
    organizationId,
    afterPosition: firstPage[0]!.globalPosition,
    eventTypes: ["WorkItem.StateChanged"],
  });

  assert.equal(firstPage.length, 1);
  assert.deepEqual(secondPage.map((event) => event.entityVersion), [2]);
});

test("outbox delivery state is retryable and publication is idempotent", async () => {
  const store = new InMemoryAuditStore();
  const executor = new AuditCommandExecutor(store);

  await executor.execute(command("create", "CreateWorkItem", { id: "work-1" }), (tx) => {
    tx.createAuditedEntity({
      entityType: "work_item",
      entityId: "work-1",
      data: { state: "draft" },
      event: createdEvent(),
    });
    return { ok: true };
  });

  const pending = store.listPendingOutbox();
  assert.equal(pending.length, 1);
  const failed = await store.recordOutboxFailure(pending[0]!.messageId, "broker offline");
  assert.equal(failed.attempts, 1);
  assert.equal(failed.lastError, "broker offline");

  const publishedAt = new Date("2026-08-11T00:00:00.000Z");
  const published = await store.markOutboxPublished(pending[0]!.messageId, publishedAt);
  const replay = await store.markOutboxPublished(pending[0]!.messageId, new Date());
  assert.equal(published.attempts, 2);
  assert.equal(replay.attempts, 2);
  assert.equal(replay.publishedAt, publishedAt.toISOString());
  assert.deepEqual(store.listPendingOutbox(), []);
});

test("returned audit records are copies and cannot mutate append-only history", async () => {
  const store = new InMemoryAuditStore();
  const executor = new AuditCommandExecutor(store);

  await executor.execute(command("create", "CreateWorkItem", { id: "work-1" }), (tx) => {
    tx.createAuditedEntity({
      entityType: "work_item",
      entityId: "work-1",
      data: { state: "draft" },
      event: createdEvent(),
    });
    return { ok: true };
  });

  const events = store.queryDomainEvents({ organizationId });
  events[0]!.payload.state = "tampered";
  const storedAgain = store.queryDomainEvents({ organizationId });
  assert.equal(storedAgain[0]!.payload.state, "draft");
});
