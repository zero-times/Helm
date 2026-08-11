import { DomainValidationError } from "./errors.ts";
import { requireNonBlank, toTimestamp } from "./execution.ts";
import {
  ARTIFACT_KINDS,
  CHANGE_SET_KINDS,
  ISSUE_SEVERITIES,
  TEST_STATUSES,
  VERIFICATION_SOURCES,
  type ArtifactReference,
  type ArtifactReferenceInput,
  type ExecutionResult,
  type HumanDecision,
  type JsonValue,
  type KnownIssue,
  type ManualExecution,
  type Money,
  type ResultContractInput,
  type SessionReference,
  type TerminalExecutionStatus,
  type TestResultReference,
} from "./types.ts";

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneJsonValue(item)));
  }
  if (value !== null && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]),
      ),
    );
  }
  return value;
}

function uniqueNonBlank(values: readonly string[], field: string): readonly string[] {
  const normalized = values.map((value, index) =>
    requireNonBlank(value, `${field}[${index}]`),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new DomainValidationError(`${field} must not contain duplicates`);
  }
  return Object.freeze(normalized);
}

function assertUniqueIds(
  values: readonly { readonly id: string }[],
  field: string,
): void {
  const ids = values.map((value) => value.id);
  if (new Set(ids).size !== ids.length) {
    throw new DomainValidationError(`${field} IDs must be unique`);
  }
}

function normalizeArtifact(input: ArtifactReferenceInput): ArtifactReference {
  if (!ARTIFACT_KINDS.includes(input.kind)) {
    throw new DomainValidationError(`Unsupported artifact kind: ${input.kind}`);
  }
  if (
    input.sizeBytes !== undefined &&
    (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0)
  ) {
    throw new DomainValidationError("artifact sizeBytes must be a non-negative integer");
  }
  const metadata = Object.freeze(
    Object.fromEntries(
      Object.entries(input.metadata ?? {}).map(([key, value]) => [
        key,
        cloneJsonValue(value),
      ]),
    ),
  );
  const digest = input.digest
    ? Object.freeze({
        algorithm: input.digest.algorithm,
        value: requireNonBlank(input.digest.value, "artifact.digest.value"),
      })
    : null;
  if (digest && digest.algorithm !== "sha256") {
    throw new DomainValidationError(
      `Unsupported artifact digest algorithm: ${digest.algorithm}`,
    );
  }

  return Object.freeze({
    id: requireNonBlank(input.id, "artifact.id"),
    kind: input.kind,
    name: requireNonBlank(input.name, "artifact.name"),
    uri: requireNonBlank(input.uri, "artifact.uri"),
    mediaType: input.mediaType?.trim() || null,
    digest,
    sizeBytes: input.sizeBytes ?? null,
    metadata,
  });
}

function normalizeTests(
  inputs: ResultContractInput["tests"],
  artifactIds: ReadonlySet<string>,
): readonly TestResultReference[] {
  const tests = (inputs ?? []).map((input) => {
    if (!TEST_STATUSES.includes(input.status)) {
      throw new DomainValidationError(`Unsupported test status: ${input.status}`);
    }
    const linkedArtifactIds = uniqueNonBlank(
      input.artifactIds ?? [],
      "test.artifactIds",
    );
    for (const artifactId of linkedArtifactIds) {
      if (!artifactIds.has(artifactId)) {
        throw new DomainValidationError(
          `Test ${input.id} references unknown artifact ${artifactId}`,
        );
      }
    }
    return Object.freeze({
      id: requireNonBlank(input.id, "test.id"),
      name: requireNonBlank(input.name, "test.name"),
      status: input.status,
      command: input.command?.trim() || null,
      details: input.details?.trim() || null,
      artifactIds: linkedArtifactIds,
    });
  });
  assertUniqueIds(tests, "test");
  return Object.freeze(tests);
}

function normalizeKnownIssues(
  inputs: ResultContractInput["knownIssues"],
): readonly KnownIssue[] {
  const issues = (inputs ?? []).map((input) => {
    if (!ISSUE_SEVERITIES.includes(input.severity)) {
      throw new DomainValidationError(`Unsupported issue severity: ${input.severity}`);
    }
    return Object.freeze({
      id: requireNonBlank(input.id, "knownIssue.id"),
      title: requireNonBlank(input.title, "knownIssue.title"),
      description: requireNonBlank(
        input.description,
        "knownIssue.description",
      ),
      severity: input.severity,
      blocking: input.blocking,
    });
  });
  assertUniqueIds(issues, "known issue");
  return Object.freeze(issues);
}

function normalizeHumanDecision(
  input: ResultContractInput,
): { needsHumanDecision: boolean; humanDecision: HumanDecision | null } {
  const needsHumanDecision =
    input.needsHumanDecision ?? input.humanDecision !== undefined;
  if (needsHumanDecision !== (input.humanDecision !== undefined)) {
    throw new DomainValidationError(
      "needsHumanDecision must match the presence of humanDecision",
    );
  }
  if (!input.humanDecision) {
    return { needsHumanDecision: false, humanDecision: null };
  }
  return {
    needsHumanDecision: true,
    humanDecision: Object.freeze({
      question: requireNonBlank(
        input.humanDecision.question,
        "humanDecision.question",
      ),
      context: requireNonBlank(
        input.humanDecision.context,
        "humanDecision.context",
      ),
      options: uniqueNonBlank(
        input.humanDecision.options ?? [],
        "humanDecision.options",
      ),
    }),
  };
}

function normalizeSessionReference(
  input: ResultContractInput["sessionReference"],
): SessionReference | null {
  if (!input) return null;
  return Object.freeze({
    provider: requireNonBlank(input.provider, "sessionReference.provider"),
    externalSessionId: requireNonBlank(
      input.externalSessionId,
      "sessionReference.externalSessionId",
    ),
    machineId: input.machineId?.trim() || null,
    workspacePath: input.workspacePath?.trim() || null,
  });
}

function normalizeCost(input: ResultContractInput["actualCost"]): Money | null {
  if (!input) return null;
  if (!Number.isSafeInteger(input.minorUnits) || input.minorUnits < 0) {
    throw new DomainValidationError(
      "actualCost.minorUnits must be a non-negative integer",
    );
  }
  return Object.freeze({
    currency: requireNonBlank(input.currency, "actualCost.currency").toUpperCase(),
    minorUnits: input.minorUnits,
  });
}

export function createExecutionResult(
  execution: ManualExecution,
  outcome: TerminalExecutionStatus,
  input: ResultContractInput,
  createdAtValue: string | Date,
): ExecutionResult {
  if (!VERIFICATION_SOURCES.includes(input.verificationSource)) {
    throw new DomainValidationError(
      `Unsupported verification source: ${input.verificationSource}`,
    );
  }
  if (
    input.durationMs !== undefined &&
    (!Number.isSafeInteger(input.durationMs) || input.durationMs < 0)
  ) {
    throw new DomainValidationError("durationMs must be a non-negative integer");
  }
  const createdAt = toTimestamp(createdAtValue, "result.createdAt");
  if (Date.parse(createdAt) < Date.parse(execution.startedAt)) {
    throw new DomainValidationError(
      "result.createdAt must not be before execution.startedAt",
    );
  }

  const artifacts = Object.freeze((input.artifacts ?? []).map(normalizeArtifact));
  assertUniqueIds(artifacts, "artifact");
  const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
  const decision = normalizeHumanDecision(input);
  if (input.changeSet && !CHANGE_SET_KINDS.includes(input.changeSet.kind)) {
    throw new DomainValidationError(
      `Unsupported change set kind: ${input.changeSet.kind}`,
    );
  }
  const changeSet = input.changeSet
    ? Object.freeze({
        kind: input.changeSet.kind,
        reference: requireNonBlank(
          input.changeSet.reference,
          "changeSet.reference",
        ),
      })
    : null;

  return Object.freeze({
    id: requireNonBlank(input.id, "result.id"),
    executionId: execution.id,
    workItemId: execution.workItemId,
    outcome,
    summary: requireNonBlank(input.summary, "result.summary"),
    changedFiles: uniqueNonBlank(input.changedFiles ?? [], "changedFiles"),
    changeSet,
    commitReference: input.commitReference?.trim() || null,
    tests: normalizeTests(input.tests, artifactIds),
    artifacts,
    knownIssues: normalizeKnownIssues(input.knownIssues),
    needsHumanDecision: decision.needsHumanDecision,
    humanDecision: decision.humanDecision,
    sessionReference: normalizeSessionReference(input.sessionReference),
    actualCost: normalizeCost(input.actualCost),
    durationMs: input.durationMs ?? null,
    verificationSource: input.verificationSource,
    createdAt,
  });
}
