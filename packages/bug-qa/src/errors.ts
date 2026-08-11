export class BugDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class BugValidationError extends BugDomainError {}

export class BugNotFoundError extends BugDomainError {
  constructor(bugId: string) {
    super(`Bug ${bugId} was not found`);
  }
}

export class QaRegressionNotFoundError extends BugDomainError {
  constructor(regressionId: string) {
    super(`QA regression ${regressionId} was not found`);
  }
}

export class BugVersionConflictError extends BugDomainError {
  constructor(bugId: string, expected: number, actual: number) {
    super(`Bug ${bugId} version conflict: expected ${expected}, actual ${actual}`);
  }
}

export class QaRegressionVersionConflictError extends BugDomainError {
  constructor(regressionId: string, expected: number, actual: number) {
    super(
      `QA regression ${regressionId} version conflict: expected ${expected}, actual ${actual}`,
    );
  }
}

export class InvalidBugTransitionError extends BugDomainError {
  constructor(from: string, to: string) {
    super(`Bug cannot transition from ${from} to ${to}`);
  }
}

export class InvalidQaRegressionTransitionError extends BugDomainError {
  constructor(from: string, to: string) {
    super(`QA regression cannot transition from ${from} to ${to}`);
  }
}

export class DuplicateBugRecordError extends BugDomainError {
  constructor(value: string) {
    super(`A Bug workflow record already exists for ${value}`);
  }
}

export class RequirementBlockedByBugsError extends BugDomainError {
  readonly requirementId: string;
  readonly bugIds: readonly string[];

  constructor(requirementId: string, bugIds: readonly string[]) {
    super(
      `Requirement ${requirementId} is blocked by Bugs: ${bugIds.join(", ")}`,
    );
    this.requirementId = requirementId;
    this.bugIds = Object.freeze([...bugIds]);
  }
}
