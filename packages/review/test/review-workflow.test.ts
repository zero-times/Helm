import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  InMemoryExecutionRepository,
  ManualExecutionService,
  type ExecutionResult,
  type ManualExecution,
} from "../../execution/src/index.ts";
import {
  GateBlockedError,
  HumanGatePolicy,
  InMemoryReviewRepository,
  InvalidReviewTransitionError,
  ReviewValidationError,
  ReviewWorkflowService,
} from "../src/index.ts";

const WORK_ITEM_ID = "00000000-0000-4000-8000-000000000001";
const EXECUTOR_ID = "00000000-0000-4000-8000-000000000002";
const REVIEWER_ID = "00000000-0000-4000-8000-000000000003";
const ORIGINAL_EXECUTION_ID = "00000000-0000-4000-8000-000000000101";
const ORIGINAL_RESULT_ID = "00000000-0000-4000-8000-000000000201";
const REVIEW_ID = "00000000-0000-4000-8000-000000000301";
const GATE_ID = "00000000-0000-4000-8000-000000000401";
const REWORK_ID = "00000000-0000-4000-8000-000000000501";
const REWORK_EXECUTION_ID = "00000000-0000-4000-8000-000000000102";

interface Harness {
  readonly executions: InMemoryExecutionRepository;
  readonly executionService: ManualExecutionService;
  readonly reviews: InMemoryReviewRepository;
  readonly workflow: ReviewWorkflowService;
  readonly gates: HumanGatePolicy;
}

function harness(
  reworkStartGuard?: { assertCanStart(): void },
): Harness {
  const executions = new InMemoryExecutionRepository();
  const executionService = new ManualExecutionService(executions);
  const reviews = new InMemoryReviewRepository(executions);
  const workflow = new ReviewWorkflowService(
    reviews,
    executions,
    reworkStartGuard ?? { assertCanStart: () => undefined },
  );
  return {
    executions,
    executionService,
    reviews,
    workflow,
    gates: new HumanGatePolicy(reviews),
  };
}

async function completeExecution(
  state: Harness,
  executionId = ORIGINAL_EXECUTION_ID,
  resultId = ORIGINAL_RESULT_ID,
): Promise<{ execution: ManualExecution; result: ExecutionResult }> {
  const started = await state.executionService.start({
    id: executionId,
    workItemId: WORK_ITEM_ID,
    graphVersion: 7,
    mode: "self",
    executorMemberId: EXECUTOR_ID,
    startedAt: "2026-08-11T03:00:00.000Z",
  });
  return state.executionService.finish({
    executionId: started.id,
    expectedVersion: 1,
    outcome: "completed",
    endedAt: "2026-08-11T03:10:00.000Z",
    result: {
      id: resultId,
      summary: "Implementation and verification completed.",
      changedFiles: ["packages/example/src/index.ts"],
      verificationSource: "human_verified",
    },
  });
}

async function requestReview(state: Harness) {
  return state.workflow.requestReview({
    reviewId: REVIEW_ID,
    gateId: GATE_ID,
    executionId: ORIGINAL_EXECUTION_ID,
    reviewerMemberId: REVIEWER_ID,
    requestedAt: "2026-08-11T03:11:00.000Z",
  });
}

describe("Review, Human gate, and Rework workflow", () => {
  it("allows reviewed completion only after an explicit approval", async () => {
    const state = harness();
    await completeExecution(state);
    const pending = await requestReview(state);

    await assert.rejects(
      state.gates.assertReviewedWorkItemCanComplete({
        gateId: pending.gate.id,
        workItemId: WORK_ITEM_ID,
        graphVersion: 7,
      }),
      GateBlockedError,
    );

    const approved = await state.workflow.approve({
      reviewId: pending.review.id,
      expectedReviewVersion: 1,
      expectedGateVersion: 1,
      occurredAt: "2026-08-11T03:12:00.000Z",
      comment: "Acceptance criteria verified.",
    });

    assert.equal(approved.review.status, "approved");
    assert.equal(approved.gate.status, "passed");
    assert.ok(Object.isFrozen(approved.review));
    assert.ok(Object.isFrozen(approved.gate));
    await state.gates.assertReviewedWorkItemCanComplete({
      gateId: approved.gate.id,
      workItemId: WORK_ITEM_ID,
      graphVersion: 7,
    });
  });

  it("keeps downstream nodes unready until every required gate passes", async () => {
    const state = harness();
    await completeExecution(state);
    await requestReview(state);

    const pending = await state.gates.evaluateDownstreamReadiness([
      GATE_ID,
      "00000000-0000-4000-8000-999999999999",
    ]);
    assert.deepEqual(pending, {
      ready: false,
      blockingGateIds: [
        GATE_ID,
        "00000000-0000-4000-8000-999999999999",
      ],
    });

    await state.workflow.approve({
      reviewId: REVIEW_ID,
      expectedReviewVersion: 1,
      expectedGateVersion: 1,
      occurredAt: "2026-08-11T03:12:00.000Z",
    });
    assert.deepEqual(await state.gates.evaluateDownstreamReadiness([GATE_ID]), {
      ready: true,
      blockingGateIds: [],
    });
  });

  it("rejects into an explicit path and creates a new Execution for Rework", async () => {
    const state = harness();
    const original = await completeExecution(state);
    await requestReview(state);

    const rejected = await state.workflow.reject({
      reviewId: REVIEW_ID,
      expectedReviewVersion: 1,
      expectedGateVersion: 1,
      reworkRequestId: REWORK_ID,
      reason: "Add the missing rollback verification.",
      occurredAt: "2026-08-11T03:12:00.000Z",
    });

    assert.equal(rejected.review.status, "rejected");
    assert.equal(rejected.gate.status, "rework_required");
    assert.deepEqual(
      {
        previousExecutionId: rejected.rework.previousExecutionId,
        previousResultId: rejected.rework.previousResultId,
        status: rejected.rework.status,
      },
      {
        previousExecutionId: original.execution.id,
        previousResultId: original.result.id,
        status: "requested",
      },
    );
    assert.equal(
      (await state.gates.evaluateDownstreamReadiness([GATE_ID])).ready,
      false,
    );

    const started = await state.workflow.startRework({
      reworkRequestId: REWORK_ID,
      expectedVersion: 1,
      executionId: REWORK_EXECUTION_ID,
      mode: "self",
      executorMemberId: EXECUTOR_ID,
      startedAt: "2026-08-11T03:13:00.000Z",
    });

    assert.equal(started.rework.status, "started");
    assert.equal(started.rework.newExecutionId, REWORK_EXECUTION_ID);
    assert.equal(started.execution.status, "running");
    assert.equal(started.execution.workItemId, original.execution.workItemId);
    assert.equal(started.execution.graphVersion, original.execution.graphVersion);
    assert.notEqual(started.execution.id, original.execution.id);
    assert.strictEqual(
      await state.executions.findExecution(original.execution.id),
      original.execution,
    );
    assert.strictEqual(
      await state.executions.findResultByExecutionId(original.execution.id),
      original.result,
    );
    assert.deepEqual(
      (await state.executions.listExecutionsForWorkItem(WORK_ITEM_ID)).map(
        ({ id, status }) => ({ id, status }),
      ),
      [
        { id: ORIGINAL_EXECUTION_ID, status: "completed" },
        { id: REWORK_EXECUTION_ID, status: "running" },
      ],
    );
  });

  it("keeps terminal Review and gate decisions immutable", async () => {
    const state = harness();
    await completeExecution(state);
    await requestReview(state);
    await state.workflow.reject({
      reviewId: REVIEW_ID,
      expectedReviewVersion: 1,
      expectedGateVersion: 1,
      reworkRequestId: REWORK_ID,
      reason: "Verification is incomplete.",
      occurredAt: "2026-08-11T03:12:00.000Z",
    });

    await assert.rejects(
      state.workflow.approve({
        reviewId: REVIEW_ID,
        expectedReviewVersion: 2,
        expectedGateVersion: 2,
        occurredAt: "2026-08-11T03:13:00.000Z",
      }),
      InvalidReviewTransitionError,
    );
    assert.equal((await state.reviews.findReview(REVIEW_ID))?.status, "rejected");
    assert.equal((await state.reviews.findGate(GATE_ID))?.status, "rework_required");
  });

  it("does not create Rework state or an Execution when its start guard rejects", async () => {
    const state = harness({
      assertCanStart() {
        throw new Error("WorkItem is not ready for Rework");
      },
    });
    await completeExecution(state);
    await requestReview(state);
    await state.workflow.reject({
      reviewId: REVIEW_ID,
      expectedReviewVersion: 1,
      expectedGateVersion: 1,
      reworkRequestId: REWORK_ID,
      reason: "Verification is incomplete.",
      occurredAt: "2026-08-11T03:12:00.000Z",
    });

    await assert.rejects(
      state.workflow.startRework({
        reworkRequestId: REWORK_ID,
        expectedVersion: 1,
        executionId: REWORK_EXECUTION_ID,
        mode: "self",
        executorMemberId: EXECUTOR_ID,
        startedAt: "2026-08-11T03:13:00.000Z",
      }),
      /WorkItem is not ready for Rework/,
    );
    assert.equal((await state.reviews.findRework(REWORK_ID))?.status, "requested");
    assert.equal(
      await state.executions.findExecution(REWORK_EXECUTION_ID),
      undefined,
    );
  });

  it("refuses to review failed Execution Results", async () => {
    const state = harness();
    const started = await state.executionService.start({
      id: ORIGINAL_EXECUTION_ID,
      workItemId: WORK_ITEM_ID,
      graphVersion: 7,
      mode: "self",
      executorMemberId: EXECUTOR_ID,
      startedAt: "2026-08-11T03:00:00.000Z",
    });
    await state.executionService.finish({
      executionId: started.id,
      expectedVersion: 1,
      outcome: "failed",
      endReason: "Tests failed.",
      endedAt: "2026-08-11T03:10:00.000Z",
      result: {
        id: ORIGINAL_RESULT_ID,
        summary: "Tests failed.",
        verificationSource: "human_verified",
      },
    });

    await assert.rejects(requestReview(state), ReviewValidationError);
  });
});
