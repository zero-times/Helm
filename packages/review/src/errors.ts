export class ReviewDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ReviewValidationError extends ReviewDomainError {}

export class ReviewNotFoundError extends ReviewDomainError {
  constructor(reviewId: string) {
    super(`Review ${reviewId} was not found`);
  }
}

export class GateNotFoundError extends ReviewDomainError {
  constructor(gateId: string) {
    super(`Human gate ${gateId} was not found`);
  }
}

export class ReworkNotFoundError extends ReviewDomainError {
  constructor(reworkId: string) {
    super(`Rework request ${reworkId} was not found`);
  }
}

export class ResultNotFoundError extends ReviewDomainError {
  constructor(executionId: string) {
    super(`Execution ${executionId} does not have a Result to review`);
  }
}

export class DuplicateReviewError extends ReviewDomainError {
  constructor(value: string) {
    super(`A Review already exists for ${value}`);
  }
}

export class ReviewVersionConflictError extends ReviewDomainError {
  constructor(reviewId: string, expected: number, actual: number) {
    super(
      `Review ${reviewId} version conflict: expected ${expected}, actual ${actual}`,
    );
  }
}

export class GateVersionConflictError extends ReviewDomainError {
  constructor(gateId: string, expected: number, actual: number) {
    super(
      `Human gate ${gateId} version conflict: expected ${expected}, actual ${actual}`,
    );
  }
}

export class ReworkVersionConflictError extends ReviewDomainError {
  constructor(reworkId: string, expected: number, actual: number) {
    super(
      `Rework request ${reworkId} version conflict: expected ${expected}, actual ${actual}`,
    );
  }
}

export class InvalidReviewTransitionError extends ReviewDomainError {
  constructor(from: string, to: string) {
    super(`Review cannot transition from ${from} to ${to}`);
  }
}

export class InvalidGateTransitionError extends ReviewDomainError {
  constructor(from: string, to: string) {
    super(`Human gate cannot transition from ${from} to ${to}`);
  }
}

export class InvalidReworkTransitionError extends ReviewDomainError {
  constructor(from: string, to: string) {
    super(`Rework request cannot transition from ${from} to ${to}`);
  }
}

export class GateBlockedError extends ReviewDomainError {
  readonly gateIds: readonly string[];

  constructor(gateIds: readonly string[]) {
    super(`Human gates are not passed: ${gateIds.join(", ")}`);
    this.gateIds = Object.freeze([...gateIds]);
  }
}
