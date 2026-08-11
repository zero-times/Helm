import { InvalidAuditInputError } from "./errors.ts";
import { commandFingerprint } from "./stable-json.ts";
import type {
  CommandEnvelope,
  CommandOutcome,
  JsonValue,
} from "./types.ts";

export interface AtomicCommandStore<TTransaction> {
  executeCommand<TResult extends JsonValue>(
    command: CommandEnvelope,
    requestFingerprint: string,
    handler: (transaction: TTransaction) => Promise<TResult> | TResult,
  ): Promise<CommandOutcome<TResult>>;
}

function requireText(value: string, label: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidAuditInputError(`${label} is required.`);
  }
}

export class AuditCommandExecutor<TTransaction> {
  private readonly store: AtomicCommandStore<TTransaction>;

  constructor(store: AtomicCommandStore<TTransaction>) {
    this.store = store;
  }

  execute<TPayload extends JsonValue, TResult extends JsonValue>(
    command: CommandEnvelope<TPayload>,
    handler: (transaction: TTransaction) => Promise<TResult> | TResult,
  ): Promise<CommandOutcome<TResult>> {
    requireText(command.organizationId, "organizationId");
    requireText(command.commandType, "commandType");
    requireText(command.idempotencyKey, "idempotencyKey");
    requireText(command.actorMemberId, "actorMemberId");
    requireText(command.source, "source");
    if (
      command.graphVersion !== undefined &&
      (!Number.isInteger(command.graphVersion) || command.graphVersion < 1)
    ) {
      throw new InvalidAuditInputError("graphVersion must be a positive integer.");
    }

    const fingerprint = commandFingerprint(command.commandType, command.payload);
    return this.store.executeCommand(command, fingerprint, handler);
  }
}
