/**
 * Domain errors for HELM core domain.
 * All errors carry a machine-readable code and a human-readable message.
 */

export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  readonly statusCode = 404;

  constructor(entity: string, id?: string) {
    super(id ? `${entity} not found: ${id}` : `${entity} not found`);
  }
}

export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_ERROR';
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
  }
}

export class ConflictError extends DomainError {
  readonly code = 'CONFLICT';
  readonly statusCode = 409;

  constructor(message: string) {
    super(message);
  }
}

export class CrossOrganizationError extends DomainError {
  readonly code = 'CROSS_ORGANIZATION';
  readonly statusCode = 422;

  constructor(field: string) {
    super(`${field} must belong to the same organization`);
  }
}

export class AccountableHumanRequiredError extends DomainError {
  readonly code = 'ACCOUNTABLE_HUMAN_REQUIRED';
  readonly statusCode = 422;

  constructor() {
    super('Accountable human must be a Human member in the same organization');
  }
}

export class NonEmptyFieldRequiredError extends DomainError {
  readonly code = 'NON_EMPTY_FIELD_REQUIRED';
  readonly statusCode = 400;

  constructor(field: string) {
    super(`${field} must not be empty`);
  }
}
