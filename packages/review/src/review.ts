import type { ExecutionResult, ManualExecution } from "../../execution/src/index.ts";
import {
  requireNonBlank,
  toTimestamp,
} from "../../execution/src/index.ts";
import {
  GateVersionConflictError,
  InvalidGateTransitionError,
  InvalidReviewTransitionError,
  InvalidReworkTransitionError,
  ReviewValidationError,
  ReviewVersionConflictError,
  ReworkVersionConflictError,
} from "./errors.ts";
import type {
  HumanGate,
  RequestReviewInput,
  Review,
  ReworkRequest,
} from "./types.ts";

function assertNotBefore(candidate: string, earliest: string, field: string): void {
  if (Date.parse(candidate) < Date.parse(earliest)) {
    throw new ReviewValidationError(`${field} must not be before ${earliest}`);
  }
}

export function createPendingReview(
  execution: ManualExecution,
  result: ExecutionResult,
  input: RequestReviewInput,
): { review: Review; gate: HumanGate } {
  if (execution.status !== "completed" || result.outcome !== "completed") {
    throw new ReviewValidationError(
      "Only a completed Execution Result can enter review",
    );
  }
  if (
    result.executionId !== execution.id ||
    result.workItemId !== execution.workItemId
  ) {
    throw new ReviewValidationError("Result does not match its Execution");
  }
  const requestedAt = toTimestamp(input.requestedAt, "requestedAt");
  assertNotBefore(requestedAt, result.createdAt, "requestedAt");
  const reviewId = requireNonBlank(input.reviewId, "reviewId");

  const review = Object.freeze({
    id: reviewId,
    resultId: result.id,
    executionId: execution.id,
    workItemId: execution.workItemId,
    graphVersion: execution.graphVersion,
    reviewerMemberId: requireNonBlank(
      input.reviewerMemberId,
      "reviewerMemberId",
    ),
    status: "pending" as const,
    requestedAt,
    decidedAt: null,
    decisionComment: null,
    version: 1,
  });
  const gate = Object.freeze({
    id: requireNonBlank(input.gateId, "gateId"),
    reviewId,
    workItemId: execution.workItemId,
    graphVersion: execution.graphVersion,
    status: "pending" as const,
    openedAt: requestedAt,
    resolvedAt: null,
    version: 1,
  });
  return { review, gate };
}

function assertReviewVersion(review: Review, expectedVersion: number): void {
  if (review.version !== expectedVersion) {
    throw new ReviewVersionConflictError(
      review.id,
      expectedVersion,
      review.version,
    );
  }
}

function assertGateVersion(gate: HumanGate, expectedVersion: number): void {
  if (gate.version !== expectedVersion) {
    throw new GateVersionConflictError(gate.id, expectedVersion, gate.version);
  }
}

export function approveReview(
  review: Review,
  expectedVersion: number,
  occurredAtValue: string | Date,
  comment?: string,
): Review {
  assertReviewVersion(review, expectedVersion);
  if (review.status !== "pending") {
    throw new InvalidReviewTransitionError(review.status, "approved");
  }
  const occurredAt = toTimestamp(occurredAtValue, "occurredAt");
  assertNotBefore(occurredAt, review.requestedAt, "occurredAt");
  return Object.freeze({
    ...review,
    status: "approved" as const,
    decidedAt: occurredAt,
    decisionComment: comment?.trim() || null,
    version: review.version + 1,
  });
}

export function rejectReview(
  review: Review,
  expectedVersion: number,
  occurredAtValue: string | Date,
  reason: string,
): Review {
  assertReviewVersion(review, expectedVersion);
  if (review.status !== "pending") {
    throw new InvalidReviewTransitionError(review.status, "rejected");
  }
  const occurredAt = toTimestamp(occurredAtValue, "occurredAt");
  assertNotBefore(occurredAt, review.requestedAt, "occurredAt");
  return Object.freeze({
    ...review,
    status: "rejected" as const,
    decidedAt: occurredAt,
    decisionComment: requireNonBlank(reason, "reason"),
    version: review.version + 1,
  });
}

export function resolveGate(
  gate: HumanGate,
  expectedVersion: number,
  status: "passed" | "rework_required",
  occurredAtValue: string | Date,
): HumanGate {
  assertGateVersion(gate, expectedVersion);
  if (gate.status !== "pending") {
    throw new InvalidGateTransitionError(gate.status, status);
  }
  const occurredAt = toTimestamp(occurredAtValue, "occurredAt");
  assertNotBefore(occurredAt, gate.openedAt, "occurredAt");
  return Object.freeze({
    ...gate,
    status,
    resolvedAt: occurredAt,
    version: gate.version + 1,
  });
}

export function createReworkRequest(
  review: Review,
  id: string,
): ReworkRequest {
  if (review.status !== "rejected" || !review.decidedAt || !review.decisionComment) {
    throw new ReviewValidationError(
      "A Rework request requires a rejected Review with a reason",
    );
  }
  return Object.freeze({
    id: requireNonBlank(id, "reworkRequestId"),
    rejectedReviewId: review.id,
    previousExecutionId: review.executionId,
    previousResultId: review.resultId,
    workItemId: review.workItemId,
    graphVersion: review.graphVersion,
    reason: review.decisionComment,
    status: "requested" as const,
    requestedAt: review.decidedAt,
    newExecutionId: null,
    startedAt: null,
    version: 1,
  });
}

export function startReworkRequest(
  rework: ReworkRequest,
  expectedVersion: number,
  execution: ManualExecution,
): ReworkRequest {
  if (rework.version !== expectedVersion) {
    throw new ReworkVersionConflictError(
      rework.id,
      expectedVersion,
      rework.version,
    );
  }
  if (rework.status !== "requested") {
    throw new InvalidReworkTransitionError(rework.status, "started");
  }
  if (
    execution.workItemId !== rework.workItemId ||
    execution.graphVersion !== rework.graphVersion
  ) {
    throw new ReviewValidationError(
      "Rework Execution must preserve the WorkItem and graph version",
    );
  }
  assertNotBefore(execution.startedAt, rework.requestedAt, "startedAt");
  return Object.freeze({
    ...rework,
    status: "started" as const,
    newExecutionId: execution.id,
    startedAt: execution.startedAt,
    version: rework.version + 1,
  });
}
