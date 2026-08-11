import {
  DomainValidationError,
  DuplicateExecutionError,
  DuplicateResultIdError,
  ExecutionNotFoundError,
  ExecutionVersionConflictError,
  ResultAlreadyExistsError,
} from "./errors.ts";
import { isTerminalExecution } from "./execution.ts";
import type { ExecutionResult, ManualExecution } from "./types.ts";

export interface ExecutionRepository {
  insertExecution(execution: ManualExecution): Promise<void>;
  findExecution(executionId: string): Promise<ManualExecution | undefined>;
  saveExecution(
    execution: ManualExecution,
    expectedVersion: number,
  ): Promise<void>;
  finishExecution(
    execution: ManualExecution,
    result: ExecutionResult,
    expectedVersion: number,
  ): Promise<void>;
  findResultByExecutionId(
    executionId: string,
  ): Promise<ExecutionResult | undefined>;
  listExecutionsForWorkItem(workItemId: string): Promise<readonly ManualExecution[]>;
  listResultsForWorkItem(workItemId: string): Promise<readonly ExecutionResult[]>;
}

function assertExecutionIdentityUnchanged(
  current: ManualExecution,
  next: ManualExecution,
): void {
  const identityChanged =
    current.id !== next.id ||
    current.workItemId !== next.workItemId ||
    current.graphVersion !== next.graphVersion ||
    current.mode !== next.mode ||
    current.executorMemberId !== next.executorMemberId ||
    current.startedAt !== next.startedAt;
  if (identityChanged) {
    throw new DomainValidationError(
      `Execution ${current.id} identity fields are immutable`,
    );
  }
}

/**
 * Deterministic repository used by domain tests and consumers that do not yet
 * have the PostgreSQL adapter wired. Result facts are insert-only, and the
 * terminal execution update plus result insert are committed as one operation.
 */
export class InMemoryExecutionRepository implements ExecutionRepository {
  readonly #executions = new Map<string, ManualExecution>();
  readonly #resultsById = new Map<string, ExecutionResult>();
  readonly #resultsByExecutionId = new Map<string, ExecutionResult>();

  async insertExecution(execution: ManualExecution): Promise<void> {
    if (this.#executions.has(execution.id)) {
      throw new DuplicateExecutionError(execution.id);
    }
    this.#executions.set(execution.id, execution);
  }

  async findExecution(executionId: string): Promise<ManualExecution | undefined> {
    return this.#executions.get(executionId);
  }

  async saveExecution(
    execution: ManualExecution,
    expectedVersion: number,
  ): Promise<void> {
    const current = this.#executions.get(execution.id);
    if (!current) throw new ExecutionNotFoundError(execution.id);
    this.#assertVersion(current, expectedVersion);
    assertExecutionIdentityUnchanged(current, execution);
    if (execution.version !== expectedVersion + 1) {
      throw new DomainValidationError(
        `Execution ${execution.id} must increment version exactly once`,
      );
    }
    if (isTerminalExecution(current)) {
      throw new DomainValidationError(
        `Terminal execution ${execution.id} is immutable`,
      );
    }
    this.#executions.set(execution.id, execution);
  }

  async finishExecution(
    execution: ManualExecution,
    result: ExecutionResult,
    expectedVersion: number,
  ): Promise<void> {
    const current = this.#executions.get(execution.id);
    if (!current) throw new ExecutionNotFoundError(execution.id);
    this.#assertVersion(current, expectedVersion);
    assertExecutionIdentityUnchanged(current, execution);
    if (isTerminalExecution(current)) {
      if (this.#resultsByExecutionId.has(execution.id)) {
        throw new ResultAlreadyExistsError(execution.id);
      }
      throw new DomainValidationError(
        `Terminal execution ${execution.id} is immutable`,
      );
    }
    if (!isTerminalExecution(execution)) {
      throw new DomainValidationError(
        `Execution ${execution.id} must be terminal before recording a result`,
      );
    }
    if (execution.version !== expectedVersion + 1) {
      throw new DomainValidationError(
        `Execution ${execution.id} must increment version exactly once`,
      );
    }
    if (
      result.executionId !== execution.id ||
      result.workItemId !== execution.workItemId ||
      result.outcome !== execution.status
    ) {
      throw new DomainValidationError(
        `Result ${result.id} does not match execution ${execution.id}`,
      );
    }
    if (this.#resultsByExecutionId.has(execution.id)) {
      throw new ResultAlreadyExistsError(execution.id);
    }
    if (this.#resultsById.has(result.id)) {
      throw new DuplicateResultIdError(result.id);
    }

    // All checks happen before either map is mutated, mirroring one DB transaction.
    this.#executions.set(execution.id, execution);
    this.#resultsByExecutionId.set(execution.id, result);
    this.#resultsById.set(result.id, result);
  }

  async findResultByExecutionId(
    executionId: string,
  ): Promise<ExecutionResult | undefined> {
    return this.#resultsByExecutionId.get(executionId);
  }

  async listExecutionsForWorkItem(
    workItemId: string,
  ): Promise<readonly ManualExecution[]> {
    return Object.freeze(
      [...this.#executions.values()]
        .filter((execution) => execution.workItemId === workItemId)
        .sort(
          (left, right) =>
            left.startedAt.localeCompare(right.startedAt) ||
            left.id.localeCompare(right.id),
        ),
    );
  }

  async listResultsForWorkItem(
    workItemId: string,
  ): Promise<readonly ExecutionResult[]> {
    return Object.freeze(
      [...this.#resultsById.values()]
        .filter((result) => result.workItemId === workItemId)
        .sort(
          (left, right) =>
            left.createdAt.localeCompare(right.createdAt) ||
            left.id.localeCompare(right.id),
        ),
    );
  }

  #assertVersion(current: ManualExecution, expectedVersion: number): void {
    if (current.version !== expectedVersion) {
      throw new ExecutionVersionConflictError(
        current.id,
        expectedVersion,
        current.version,
      );
    }
  }
}
