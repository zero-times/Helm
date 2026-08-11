import {
  BugValidationError,
  BugVersionConflictError,
  InvalidBugTransitionError,
  InvalidQaRegressionTransitionError,
  QaRegressionVersionConflictError,
} from "./errors.ts";
import type {
  BugFixEdge,
  BugWorkItem,
  CompleteQaRegressionInput,
  CreateBugInput,
  QaRegressionEdge,
  StartBugFixInput,
  SubmitFixForQaInput,
} from "./types.ts";
import {
  BUG_DISCOVERY_STAGES,
  BUG_REPORTER_ROLES,
  BUG_SEVERITIES,
} from "./types.ts";

export function requireNonBlank(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new BugValidationError(`${field} must not be blank`);
  return normalized;
}

export function toTimestamp(value: string | Date, field: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BugValidationError(`${field} must be a valid timestamp`);
  }
  return date.toISOString();
}

function assertNotBefore(candidate: string, earliest: string, field: string): void {
  if (Date.parse(candidate) < Date.parse(earliest)) {
    throw new BugValidationError(`${field} must not be before ${earliest}`);
  }
}

function assertBugVersion(bug: BugWorkItem, expectedVersion: number): void {
  if (bug.version !== expectedVersion) {
    throw new BugVersionConflictError(bug.id, expectedVersion, bug.version);
  }
}

export function createBug(input: CreateBugInput): BugWorkItem {
  if (!BUG_REPORTER_ROLES.includes(input.reporterRole)) {
    throw new BugValidationError("reporterRole is not supported");
  }
  if (!BUG_DISCOVERY_STAGES.includes(input.discoveredIn)) {
    throw new BugValidationError("discoveredIn is not supported");
  }
  if (!BUG_SEVERITIES.includes(input.severity)) {
    throw new BugValidationError("severity is not supported");
  }
  if (!Number.isInteger(input.graphVersion) || input.graphVersion < 1) {
    throw new BugValidationError("graphVersion must be a positive integer");
  }
  const createdAt = toTimestamp(input.createdAt, "createdAt");
  return Object.freeze({
    id: requireNonBlank(input.id, "id"),
    sourceRequirementId: requireNonBlank(
      input.sourceRequirementId,
      "sourceRequirementId",
    ),
    graphVersion: input.graphVersion,
    title: requireNonBlank(input.title, "title"),
    description: requireNonBlank(input.description, "description"),
    discoveredIn: input.discoveredIn,
    severity: input.severity,
    blocking: input.blocking,
    reporterMemberId: requireNonBlank(
      input.reporterMemberId,
      "reporterMemberId",
    ),
    status: "open" as const,
    createdAt,
    updatedAt: createdAt,
    closedAt: null,
    version: 1,
  });
}

export function startBugFix(
  bug: BugWorkItem,
  input: StartBugFixInput,
): BugWorkItem {
  assertBugVersion(bug, input.expectedBugVersion);
  if (bug.status !== "open") {
    throw new InvalidBugTransitionError(bug.status, "fix_in_progress");
  }
  const occurredAt = toTimestamp(input.occurredAt, "occurredAt");
  assertNotBefore(occurredAt, bug.updatedAt, "occurredAt");
  return Object.freeze({
    ...bug,
    status: "fix_in_progress" as const,
    updatedAt: occurredAt,
    version: bug.version + 1,
  });
}

export function submitFixForQa(
  bug: BugWorkItem,
  input: SubmitFixForQaInput,
): {
  readonly bug: BugWorkItem;
  readonly fix: BugFixEdge;
  readonly regression: QaRegressionEdge;
} {
  assertBugVersion(bug, input.expectedBugVersion);
  if (bug.status !== "fix_in_progress") {
    throw new InvalidBugTransitionError(bug.status, "awaiting_qa");
  }
  const occurredAt = toTimestamp(input.occurredAt, "occurredAt");
  assertNotBefore(occurredAt, bug.updatedAt, "occurredAt");
  const fix = Object.freeze({
    id: requireNonBlank(input.fixEdgeId, "fixEdgeId"),
    bugId: bug.id,
    executionId: requireNonBlank(input.executionId, "executionId"),
    resultId: requireNonBlank(input.resultId, "resultId"),
    reviewId: requireNonBlank(input.reviewId, "reviewId"),
    passedGateId: requireNonBlank(input.passedGateId, "passedGateId"),
    fixedAt: occurredAt,
  });
  const regression = Object.freeze({
    id: requireNonBlank(input.regressionEdgeId, "regressionEdgeId"),
    bugId: bug.id,
    fixEdgeId: fix.id,
    qaMemberId: requireNonBlank(input.qaMemberId, "qaMemberId"),
    status: "pending" as const,
    requestedAt: occurredAt,
    completedAt: null,
    notes: null,
    version: 1,
  });
  const nextBug = Object.freeze({
    ...bug,
    status: "awaiting_qa" as const,
    updatedAt: occurredAt,
    version: bug.version + 1,
  });
  return Object.freeze({ bug: nextBug, fix, regression });
}

export function completeQaRegression(
  bug: BugWorkItem,
  regression: QaRegressionEdge,
  input: CompleteQaRegressionInput,
): { readonly bug: BugWorkItem; readonly regression: QaRegressionEdge } {
  assertBugVersion(bug, input.expectedBugVersion);
  if (regression.version !== input.expectedRegressionVersion) {
    throw new QaRegressionVersionConflictError(
      regression.id,
      input.expectedRegressionVersion,
      regression.version,
    );
  }
  if (bug.status !== "awaiting_qa") {
    throw new InvalidBugTransitionError(bug.status, input.outcome === "passed" ? "closed" : "open");
  }
  if (regression.status !== "pending") {
    throw new InvalidQaRegressionTransitionError(
      regression.status,
      input.outcome,
    );
  }
  if (regression.bugId !== bug.id) {
    throw new BugValidationError("QA regression does not belong to the Bug");
  }
  const occurredAt = toTimestamp(input.occurredAt, "occurredAt");
  assertNotBefore(occurredAt, regression.requestedAt, "occurredAt");
  const passed = input.outcome === "passed";
  const nextRegression = Object.freeze({
    ...regression,
    status: input.outcome,
    completedAt: occurredAt,
    notes: input.notes?.trim() || null,
    version: regression.version + 1,
  });
  const nextBug = Object.freeze({
    ...bug,
    status: passed ? ("closed" as const) : ("open" as const),
    blocking: passed ? false : bug.blocking,
    updatedAt: occurredAt,
    closedAt: passed ? occurredAt : null,
    version: bug.version + 1,
  });
  return Object.freeze({ bug: nextBug, regression: nextRegression });
}
