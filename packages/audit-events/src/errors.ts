export class AuditError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class InvalidAuditInputError extends AuditError {
  constructor(message: string) {
    super("INVALID_AUDIT_INPUT", message);
  }
}

export class IdempotencyConflictError extends AuditError {
  readonly idempotencyKey: string;

  constructor(idempotencyKey: string) {
    super(
      "IDEMPOTENCY_CONFLICT",
      `Idempotency key '${idempotencyKey}' was already used by a different command or payload.`,
    );
    this.idempotencyKey = idempotencyKey;
  }
}

export class EntityAlreadyExistsError extends AuditError {
  constructor(entityType: string, entityId: string) {
    super(
      "ENTITY_ALREADY_EXISTS",
      `${entityType} '${entityId}' already exists.`,
    );
  }
}

export class EntityNotFoundError extends AuditError {
  constructor(entityType: string, entityId: string) {
    super("ENTITY_NOT_FOUND", `${entityType} '${entityId}' does not exist.`);
  }
}

export class OptimisticConcurrencyError extends AuditError {
  readonly entityType: string;
  readonly entityId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;

  constructor(
    entityType: string,
    entityId: string,
    expectedVersion: number,
    actualVersion: number,
  ) {
    super(
      "OPTIMISTIC_CONCURRENCY_CONFLICT",
      `${entityType} '${entityId}' is at version ${actualVersion}; expected ${expectedVersion}.`,
    );
    this.entityType = entityType;
    this.entityId = entityId;
    this.expectedVersion = expectedVersion;
    this.actualVersion = actualVersion;
  }
}

export class OutboxMessageNotFoundError extends AuditError {
  constructor(messageId: string) {
    super("OUTBOX_MESSAGE_NOT_FOUND", `Outbox message '${messageId}' does not exist.`);
  }
}
