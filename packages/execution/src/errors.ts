export class ExecutionDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class DomainValidationError extends ExecutionDomainError {}

export class ExecutionNotFoundError extends ExecutionDomainError {
  constructor(executionId: string) {
    super(`Execution ${executionId} was not found`);
  }
}

export class DuplicateExecutionError extends ExecutionDomainError {
  constructor(executionId: string) {
    super(`Execution ${executionId} already exists`);
  }
}

export class ExecutionVersionConflictError extends ExecutionDomainError {
  constructor(executionId: string, expected: number, actual: number) {
    super(
      `Execution ${executionId} version conflict: expected ${expected}, actual ${actual}`,
    );
  }
}

export class InvalidExecutionTransitionError extends ExecutionDomainError {
  constructor(from: string, to: string) {
    super(`Manual execution cannot transition from ${from} to ${to}`);
  }
}

export class ResultAlreadyExistsError extends ExecutionDomainError {
  constructor(executionId: string) {
    super(`Execution ${executionId} already has an immutable result`);
  }
}

export class DuplicateResultIdError extends ExecutionDomainError {
  constructor(resultId: string) {
    super(`Result ${resultId} already exists`);
  }
}
