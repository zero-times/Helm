import {
  DomainValidationError,
  ExecutionVersionConflictError,
  InvalidExecutionTransitionError,
} from "./errors.ts";
import {
  MANUAL_EXECUTION_MODES,
  type ManualExecution,
  type StartManualExecutionInput,
  type TerminalExecutionStatus,
} from "./types.ts";

const TERMINAL_STATUSES = new Set<TerminalExecutionStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export function requireNonBlank(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DomainValidationError(`${field} must not be blank`);
  }
  return value.trim();
}

export function toTimestamp(value: string | Date, field: string): string {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DomainValidationError(`${field} must be a valid timestamp`);
  }
  return date.toISOString();
}

function assertNotBefore(
  candidate: string,
  earliest: string,
  field: string,
): void {
  if (Date.parse(candidate) < Date.parse(earliest)) {
    throw new DomainValidationError(`${field} must not be before ${earliest}`);
  }
}

export function assertExpectedVersion(
  execution: ManualExecution,
  expectedVersion: number,
): void {
  if (execution.version !== expectedVersion) {
    throw new ExecutionVersionConflictError(
      execution.id,
      expectedVersion,
      execution.version,
    );
  }
}

export function isTerminalExecution(
  execution: ManualExecution,
): execution is ManualExecution & { status: TerminalExecutionStatus } {
  return TERMINAL_STATUSES.has(execution.status as TerminalExecutionStatus);
}

export function startManualExecution(
  input: StartManualExecutionInput,
): ManualExecution {
  const id = requireNonBlank(input.id, "id");
  const workItemId = requireNonBlank(input.workItemId, "workItemId");
  const executorMemberId = requireNonBlank(
    input.executorMemberId,
    "executorMemberId",
  );
  if (!Number.isSafeInteger(input.graphVersion) || input.graphVersion < 1) {
    throw new DomainValidationError("graphVersion must be a positive integer");
  }
  if (!MANUAL_EXECUTION_MODES.includes(input.mode)) {
    throw new DomainValidationError(`Unsupported manual execution mode: ${input.mode}`);
  }

  const startedAt = toTimestamp(input.startedAt, "startedAt");
  return Object.freeze({
    id,
    workItemId,
    graphVersion: input.graphVersion,
    mode: input.mode,
    executorMemberId,
    status: "running" as const,
    startedAt,
    updatedAt: startedAt,
    endedAt: null,
    waitingReason: null,
    endReason: null,
    version: 1,
  });
}

export function waitForManualInput(
  execution: ManualExecution,
  expectedVersion: number,
  reason: string,
  occurredAt: string | Date,
): ManualExecution {
  assertExpectedVersion(execution, expectedVersion);
  if (execution.status !== "running") {
    throw new InvalidExecutionTransitionError(
      execution.status,
      "waiting_for_input",
    );
  }
  const updatedAt = toTimestamp(occurredAt, "occurredAt");
  assertNotBefore(updatedAt, execution.updatedAt, "occurredAt");

  return Object.freeze({
    ...execution,
    status: "waiting_for_input" as const,
    waitingReason: requireNonBlank(reason, "waitingReason"),
    updatedAt,
    version: execution.version + 1,
  });
}

export function resumeManualExecution(
  execution: ManualExecution,
  expectedVersion: number,
  occurredAt: string | Date,
): ManualExecution {
  assertExpectedVersion(execution, expectedVersion);
  if (execution.status !== "waiting_for_input") {
    throw new InvalidExecutionTransitionError(execution.status, "running");
  }
  const updatedAt = toTimestamp(occurredAt, "occurredAt");
  assertNotBefore(updatedAt, execution.updatedAt, "occurredAt");

  return Object.freeze({
    ...execution,
    status: "running" as const,
    waitingReason: null,
    updatedAt,
    version: execution.version + 1,
  });
}

export function finishManualExecution(
  execution: ManualExecution,
  expectedVersion: number,
  outcome: TerminalExecutionStatus,
  endedAtValue: string | Date,
  endReason?: string,
): ManualExecution {
  assertExpectedVersion(execution, expectedVersion);
  if (execution.status !== "running" && execution.status !== "waiting_for_input") {
    throw new InvalidExecutionTransitionError(execution.status, outcome);
  }
  if (!TERMINAL_STATUSES.has(outcome)) {
    throw new DomainValidationError(`Unsupported terminal outcome: ${outcome}`);
  }

  const endedAt = toTimestamp(endedAtValue, "endedAt");
  assertNotBefore(endedAt, execution.updatedAt, "endedAt");
  const normalizedEndReason = endReason?.trim() || null;
  if ((outcome === "failed" || outcome === "cancelled") && !normalizedEndReason) {
    throw new DomainValidationError(
      `${outcome} executions require a non-blank endReason`,
    );
  }

  return Object.freeze({
    ...execution,
    status: outcome,
    updatedAt: endedAt,
    endedAt,
    waitingReason: null,
    endReason: normalizedEndReason,
    version: execution.version + 1,
  });
}
