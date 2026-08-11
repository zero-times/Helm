import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BugBlockingPolicy,
  BugQaWorkflowService,
  InMemoryBugRepository,
  RequirementBlockedByBugsError,
  type PassedReviewGateInput,
} from "../src/index.ts";

const REQUIREMENT_ID = "00000000-0000-4000-8000-000000000001";
const BUG_ID = "00000000-0000-4000-8000-000000000002";
const QA_ID = "00000000-0000-4000-8000-000000000003";
const FIX_ID = "00000000-0000-4000-8000-000000000004";
const EXECUTION_ID = "00000000-0000-4000-8000-000000000005";
const RESULT_ID = "00000000-0000-4000-8000-000000000006";
const REVIEW_ID = "00000000-0000-4000-8000-000000000007";
const GATE_ID = "00000000-0000-4000-8000-000000000008";
const REGRESSION_ID = "00000000-0000-4000-8000-000000000009";

function harness(gate?: { assertReviewedWorkItemCanComplete(input: PassedReviewGateInput): void }) {
  const repository = new InMemoryBugRepository();
  const workflow = new BugQaWorkflowService(
    repository,
    gate ?? { assertReviewedWorkItemCanComplete: () => undefined },
  );
  return {
    repository,
    workflow,
    policy: new BugBlockingPolicy(repository),
  };
}

async function createBlockingBug(state: ReturnType<typeof harness>) {
  return state.workflow.create({
    id: BUG_ID,
    sourceRequirementId: REQUIREMENT_ID,
    graphVersion: 3,
    title: "Release loses audit entries",
    description: "The release path drops the final audit event.",
    discoveredIn: "qa",
    severity: "critical",
    blocking: true,
    reporterMemberId: QA_ID,
    reporterRole: "qa",
    createdAt: "2026-08-11T04:00:00.000Z",
  });
}

async function submitFix(state: ReturnType<typeof harness>) {
  await createBlockingBug(state);
  await state.workflow.startFix({
    bugId: BUG_ID,
    expectedBugVersion: 1,
    occurredAt: "2026-08-11T04:01:00.000Z",
  });
  return state.workflow.submitFixForQa({
    bugId: BUG_ID,
    expectedBugVersion: 2,
    fixEdgeId: FIX_ID,
    executionId: EXECUTION_ID,
    resultId: RESULT_ID,
    reviewId: REVIEW_ID,
    passedGateId: GATE_ID,
    regressionEdgeId: REGRESSION_ID,
    qaMemberId: QA_ID,
    occurredAt: "2026-08-11T04:02:00.000Z",
  });
}

describe("Bug WorkItem and QA return workflow", () => {
  it("allows QA to create a queryable first-class Bug", async () => {
    const state = harness();
    const bug = await createBlockingBug(state);

    assert.equal(bug.status, "open");
    assert.equal(bug.sourceRequirementId, REQUIREMENT_ID);
    assert.equal(bug.discoveredIn, "qa");
    assert.equal(bug.severity, "critical");
    assert.equal(bug.blocking, true);
    assert.ok(Object.isFrozen(bug));
    assert.deepEqual(await state.repository.listBugsForRequirement(REQUIREMENT_ID), [
      bug,
    ]);
  });

  it("blocks both requirement completion and release while a blocking Bug is open", async () => {
    const state = harness();
    await createBlockingBug(state);

    await assert.rejects(
      state.policy.assertRequirementCanComplete({ requirementId: REQUIREMENT_ID }),
      RequirementBlockedByBugsError,
    );
    await assert.rejects(
      state.policy.assertRequirementCanRelease({ requirementId: REQUIREMENT_ID }),
      RequirementBlockedByBugsError,
    );
    assert.deepEqual(await state.policy.evaluateRequirement({ requirementId: REQUIREMENT_ID }), {
      allowed: false,
      blockingBugIds: [BUG_ID],
    });
  });

  it("automatically creates Fix and pending QA regression edges after a passed Review gate", async () => {
    let checkedGate: PassedReviewGateInput | undefined;
    const state = harness({
      assertReviewedWorkItemCanComplete(input) {
        checkedGate = input;
      },
    });
    const submitted = await submitFix(state);

    assert.deepEqual(checkedGate, {
      gateId: GATE_ID,
      bugId: BUG_ID,
      sourceRequirementId: REQUIREMENT_ID,
      graphVersion: 3,
      executionId: EXECUTION_ID,
      resultId: RESULT_ID,
      reviewId: REVIEW_ID,
    });
    assert.equal(submitted.bug.status, "awaiting_qa");
    assert.equal(submitted.regression.status, "pending");
    assert.deepEqual(
      (await state.repository.listFixesForBug(BUG_ID)).map(
        ({ id, executionId, resultId, reviewId, passedGateId }) => ({
          id,
          executionId,
          resultId,
          reviewId,
          passedGateId,
        }),
      ),
      [{ id: FIX_ID, executionId: EXECUTION_ID, resultId: RESULT_ID, reviewId: REVIEW_ID, passedGateId: GATE_ID }],
    );
  });

  it("does not create edges when the Review gate is not passed", async () => {
    const state = harness({
      assertReviewedWorkItemCanComplete() {
        throw new Error("Human gate is not passed");
      },
    });
    await createBlockingBug(state);
    await state.workflow.startFix({
      bugId: BUG_ID,
      expectedBugVersion: 1,
      occurredAt: "2026-08-11T04:01:00.000Z",
    });

    await assert.rejects(
      state.workflow.submitFixForQa({
        bugId: BUG_ID,
        expectedBugVersion: 2,
        fixEdgeId: FIX_ID,
        executionId: EXECUTION_ID,
        resultId: RESULT_ID,
        reviewId: REVIEW_ID,
        passedGateId: GATE_ID,
        regressionEdgeId: REGRESSION_ID,
        qaMemberId: QA_ID,
        occurredAt: "2026-08-11T04:02:00.000Z",
      }),
      /Human gate is not passed/,
    );
    assert.equal((await state.repository.findBug(BUG_ID))?.status, "fix_in_progress");
    assert.deepEqual(await state.repository.listFixesForBug(BUG_ID), []);
    assert.deepEqual(await state.repository.listRegressionsForBug(BUG_ID), []);
  });

  it("closes and unblocks the Bug only after QA regression passes", async () => {
    const state = harness();
    await submitFix(state);
    const completed = await state.workflow.completeRegression({
      regressionEdgeId: REGRESSION_ID,
      expectedRegressionVersion: 1,
      expectedBugVersion: 3,
      outcome: "passed",
      notes: "Regression suite and release smoke test passed.",
      occurredAt: "2026-08-11T04:03:00.000Z",
    });

    assert.equal(completed.regression.status, "passed");
    assert.equal(completed.bug.status, "closed");
    assert.equal(completed.bug.blocking, false);
    assert.equal(
      (await state.policy.evaluateRequirement({ requirementId: REQUIREMENT_ID })).allowed,
      true,
    );
    await state.policy.assertRequirementCanComplete({ requirementId: REQUIREMENT_ID });
    await state.policy.assertRequirementCanRelease({ requirementId: REQUIREMENT_ID });
  });

  it("keeps the Bug blocking and returns it to open when regression fails", async () => {
    const state = harness();
    await submitFix(state);
    const completed = await state.workflow.completeRegression({
      regressionEdgeId: REGRESSION_ID,
      expectedRegressionVersion: 1,
      expectedBugVersion: 3,
      outcome: "failed",
      notes: "The audit event is still missing on retry.",
      occurredAt: "2026-08-11T04:03:00.000Z",
    });

    assert.equal(completed.regression.status, "failed");
    assert.equal(completed.bug.status, "open");
    assert.equal(completed.bug.blocking, true);
    await assert.rejects(
      state.policy.assertRequirementCanRelease({ requirementId: REQUIREMENT_ID }),
      RequirementBlockedByBugsError,
    );
    const retry = await state.workflow.startFix({
      bugId: BUG_ID,
      expectedBugVersion: 4,
      occurredAt: "2026-08-11T04:04:00.000Z",
    });
    assert.equal(retry.status, "fix_in_progress");
  });
});
