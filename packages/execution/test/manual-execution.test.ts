import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DomainValidationError,
  ExecutionVersionConflictError,
  InMemoryExecutionRepository,
  InvalidExecutionTransitionError,
  ManualExecutionService,
} from "../src/index.ts";

const STARTED_AT = "2026-08-11T03:00:00.000Z";

function startInput(id = "00000000-0000-4000-8000-000000000101") {
  return {
    id,
    workItemId: "00000000-0000-4000-8000-000000000001",
    graphVersion: 7,
    mode: "self" as const,
    executorMemberId: "00000000-0000-4000-8000-000000000002",
    startedAt: STARTED_AT,
  };
}

function basicResult(id = "00000000-0000-4000-8000-000000000201") {
  return {
    id,
    summary: "Implemented and verified the requested work.",
    verificationSource: "human_verified" as const,
  };
}

describe("manual execution lifecycle", () => {
  it("starts a versioned execution only after the Work Graph guard accepts it", async () => {
    const repository = new InMemoryExecutionRepository();
    const checked: unknown[] = [];
    const service = new ManualExecutionService(repository, {
      assertCanStart(input) {
        checked.push(input);
      },
    });

    const execution = await service.start(startInput());

    assert.deepEqual(checked, [
      {
        workItemId: execution.workItemId,
        graphVersion: 7,
        executorMemberId: execution.executorMemberId,
      },
    ]);
    assert.equal(execution.status, "running");
    assert.equal(execution.version, 1);
    assert.equal(execution.startedAt, STARTED_AT);
    assert.ok(Object.isFrozen(execution));
  });

  it("does not persist an execution rejected by the Work Graph guard", async () => {
    const repository = new InMemoryExecutionRepository();
    const service = new ManualExecutionService(repository, {
      assertCanStart() {
        throw new Error("WorkItem is not ready");
      },
    });

    await assert.rejects(service.start(startInput()), /WorkItem is not ready/);
    assert.equal(
      await repository.findExecution(
        "00000000-0000-4000-8000-000000000101",
      ),
      undefined,
    );
  });

  it("supports wait and resume while rejecting stale versions", async () => {
    const repository = new InMemoryExecutionRepository();
    const service = new ManualExecutionService(repository);
    const started = await service.start(startInput());

    const waiting = await service.waitForInput({
      executionId: started.id,
      expectedVersion: 1,
      reason: "Need the product owner to choose a compatibility target.",
      occurredAt: "2026-08-11T03:05:00.000Z",
    });
    assert.equal(waiting.status, "waiting_for_input");
    assert.equal(waiting.version, 2);

    await assert.rejects(
      service.resume({
        executionId: started.id,
        expectedVersion: 1,
        occurredAt: "2026-08-11T03:06:00.000Z",
      }),
      ExecutionVersionConflictError,
    );

    const resumed = await service.resume({
      executionId: started.id,
      expectedVersion: 2,
      occurredAt: "2026-08-11T03:07:00.000Z",
    });
    assert.equal(resumed.status, "running");
    assert.equal(resumed.waitingReason, null);
    assert.equal(resumed.version, 3);
  });

  it("atomically completes an execution with a rich immutable Result", async () => {
    const repository = new InMemoryExecutionRepository();
    const service = new ManualExecutionService(repository);
    const started = await service.start(startInput());

    const completed = await service.finish({
      executionId: started.id,
      expectedVersion: 1,
      outcome: "completed",
      endedAt: "2026-08-11T03:30:00.000Z",
      result: {
        id: "00000000-0000-4000-8000-000000000201",
        summary: "Implemented the Execution and Result contract.",
        changedFiles: ["packages/execution/src/service.ts"],
        changeSet: { kind: "commit", reference: "abc123" },
        commitReference: "abc123",
        artifacts: [
          {
            id: "00000000-0000-4000-8000-000000000301",
            kind: "report",
            name: "test-report",
            uri: "artifact://test-report.json",
            mediaType: "application/json",
            metadata: { suiteCount: 5, labels: ["domain", "acceptance"] },
          },
        ],
        tests: [
          {
            id: "00000000-0000-4000-8000-000000000401",
            name: "domain tests",
            status: "passed",
            command: "node --test test/*.test.ts",
            artifactIds: ["00000000-0000-4000-8000-000000000301"],
          },
        ],
        knownIssues: [
          {
            id: "00000000-0000-4000-8000-000000000501",
            title: "Dependency integration pending",
            description: "Work Graph table names are not finalized.",
            severity: "medium",
            blocking: false,
          },
        ],
        needsHumanDecision: true,
        humanDecision: {
          question: "Which Work Graph adapter should be used?",
          context: "HELM-10 is developed on a separate branch.",
          options: ["Drizzle adapter", "service adapter"],
        },
        actualCost: { currency: "cny", minorUnits: 150 },
        durationMs: 1_800_000,
        verificationSource: "human_verified",
      },
    });

    assert.equal(completed.execution.status, "completed");
    assert.equal(completed.result.executionId, completed.execution.id);
    assert.equal(completed.result.workItemId, completed.execution.workItemId);
    assert.equal(completed.result.tests[0]?.artifactIds[0], completed.result.artifacts[0]?.id);
    assert.deepEqual(completed.result.actualCost, {
      currency: "CNY",
      minorUnits: 150,
    });
    assert.ok(Object.isFrozen(completed.result));
    assert.ok(Object.isFrozen(completed.result.artifacts));
    assert.ok(Object.isFrozen(completed.result.artifacts[0]?.metadata));
    assert.throws(() => {
      (completed.result as { summary: string }).summary = "overwrite";
    }, TypeError);

    const stored = await repository.findResultByExecutionId(started.id);
    assert.strictEqual(stored, completed.result);
  });

  it("does not overwrite a historical Result on a second finish attempt", async () => {
    const repository = new InMemoryExecutionRepository();
    const service = new ManualExecutionService(repository);
    const started = await service.start(startInput());
    const first = await service.finish({
      executionId: started.id,
      expectedVersion: 1,
      outcome: "completed",
      endedAt: "2026-08-11T03:10:00.000Z",
      result: basicResult(),
    });

    await assert.rejects(
      service.finish({
        executionId: started.id,
        expectedVersion: 2,
        outcome: "completed",
        endedAt: "2026-08-11T03:11:00.000Z",
        result: basicResult("00000000-0000-4000-8000-000000000202"),
      }),
      InvalidExecutionTransitionError,
    );
    assert.strictEqual(
      await repository.findResultByExecutionId(started.id),
      first.result,
    );
  });

  it("retains complete failed and cancelled attempts in WorkItem history", async () => {
    const repository = new InMemoryExecutionRepository();
    const service = new ManualExecutionService(repository);
    const failedAttempt = await service.start(startInput());
    const cancelledAttempt = await service.start(
      startInput("00000000-0000-4000-8000-000000000102"),
    );

    await service.finish({
      executionId: failedAttempt.id,
      expectedVersion: 1,
      outcome: "failed",
      endReason: "Local database was unavailable.",
      endedAt: "2026-08-11T03:12:00.000Z",
      result: {
        ...basicResult(),
        summary: "Migration verification failed before any changes were applied.",
        verificationSource: "unverified",
      },
    });
    await service.finish({
      executionId: cancelledAttempt.id,
      expectedVersion: 1,
      outcome: "cancelled",
      endReason: "Scope was withdrawn by the accountable human.",
      endedAt: "2026-08-11T03:14:00.000Z",
      result: {
        ...basicResult("00000000-0000-4000-8000-000000000202"),
        summary: "Cancelled with design notes preserved as a partial result.",
        verificationSource: "unverified",
      },
    });

    const executions = await repository.listExecutionsForWorkItem(
      failedAttempt.workItemId,
    );
    const results = await repository.listResultsForWorkItem(failedAttempt.workItemId);
    assert.deepEqual(
      executions.map(({ status, endReason }) => ({ status, endReason })),
      [
        { status: "failed", endReason: "Local database was unavailable." },
        {
          status: "cancelled",
          endReason: "Scope was withdrawn by the accountable human.",
        },
      ],
    );
    assert.deepEqual(
      results.map(({ outcome }) => outcome),
      ["failed", "cancelled"],
    );
  });

  it("keeps the running state untouched when a Result contract is invalid", async () => {
    const repository = new InMemoryExecutionRepository();
    const service = new ManualExecutionService(repository);
    const started = await service.start(startInput());

    await assert.rejects(
      service.finish({
        executionId: started.id,
        expectedVersion: 1,
        outcome: "completed",
        endedAt: "2026-08-11T03:20:00.000Z",
        result: {
          ...basicResult(),
          tests: [
            {
              id: "00000000-0000-4000-8000-000000000401",
              name: "missing artifact test",
              status: "passed",
              artifactIds: ["00000000-0000-4000-8000-999999999999"],
            },
          ],
        },
      }),
      DomainValidationError,
    );

    assert.strictEqual(await repository.findExecution(started.id), started);
    assert.equal(await repository.findResultByExecutionId(started.id), undefined);
  });

  it("requires reasons for failed and cancelled terminal states", async () => {
    const repository = new InMemoryExecutionRepository();
    const service = new ManualExecutionService(repository);
    const started = await service.start(startInput());

    await assert.rejects(
      service.finish({
        executionId: started.id,
        expectedVersion: 1,
        outcome: "failed",
        endedAt: "2026-08-11T03:20:00.000Z",
        result: basicResult(),
      }),
      /failed executions require a non-blank endReason/,
    );
    assert.strictEqual(await repository.findExecution(started.id), started);
  });
});
