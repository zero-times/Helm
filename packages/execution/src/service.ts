import { ExecutionNotFoundError } from "./errors.ts";
import {
  finishManualExecution,
  resumeManualExecution,
  startManualExecution,
  waitForManualInput,
} from "./execution.ts";
import type { ExecutionRepository } from "./repository.ts";
import { createExecutionResult } from "./result.ts";
import type {
  ExecutionResult,
  FinishManualExecutionInput,
  ManualExecution,
  ManualExecutionStartGuard,
  StartManualExecutionInput,
} from "./types.ts";

const ALLOW_START: ManualExecutionStartGuard = Object.freeze({
  assertCanStart: () => undefined,
});

export interface VersionedExecutionCommand {
  readonly executionId: string;
  readonly expectedVersion: number;
  readonly occurredAt: string | Date;
}

export interface WaitForInputCommand extends VersionedExecutionCommand {
  readonly reason: string;
}

/**
 * Application service for Self and External/Manual execution attempts.
 *
 * HELM-10 can supply a start guard that checks WorkItem readiness and the bound
 * graph version. The default is intentionally permissive for isolated use and
 * tests; production composition should always inject the Work Graph guard.
 */
export class ManualExecutionService {
  readonly repository: ExecutionRepository;
  readonly startGuard: ManualExecutionStartGuard;

  constructor(
    repository: ExecutionRepository,
    startGuard: ManualExecutionStartGuard = ALLOW_START,
  ) {
    this.repository = repository;
    this.startGuard = startGuard;
  }

  async start(input: StartManualExecutionInput): Promise<ManualExecution> {
    const execution = startManualExecution(input);
    await this.startGuard.assertCanStart({
      workItemId: execution.workItemId,
      graphVersion: execution.graphVersion,
      executorMemberId: execution.executorMemberId,
    });
    await this.repository.insertExecution(execution);
    return execution;
  }

  async waitForInput(input: WaitForInputCommand): Promise<ManualExecution> {
    const current = await this.#getExecution(input.executionId);
    const next = waitForManualInput(
      current,
      input.expectedVersion,
      input.reason,
      input.occurredAt,
    );
    await this.repository.saveExecution(next, input.expectedVersion);
    return next;
  }

  async resume(input: VersionedExecutionCommand): Promise<ManualExecution> {
    const current = await this.#getExecution(input.executionId);
    const next = resumeManualExecution(
      current,
      input.expectedVersion,
      input.occurredAt,
    );
    await this.repository.saveExecution(next, input.expectedVersion);
    return next;
  }

  async finish(
    input: FinishManualExecutionInput,
  ): Promise<{ execution: ManualExecution; result: ExecutionResult }> {
    const current = await this.#getExecution(input.executionId);
    const execution = finishManualExecution(
      current,
      input.expectedVersion,
      input.outcome,
      input.endedAt,
      input.endReason,
    );
    const result = createExecutionResult(
      current,
      input.outcome,
      input.result,
      input.endedAt,
    );
    await this.repository.finishExecution(
      execution,
      result,
      input.expectedVersion,
    );
    return { execution, result };
  }

  async #getExecution(executionId: string): Promise<ManualExecution> {
    const execution = await this.repository.findExecution(executionId);
    if (!execution) throw new ExecutionNotFoundError(executionId);
    return execution;
  }
}
