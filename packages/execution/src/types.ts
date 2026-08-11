export const MANUAL_EXECUTION_MODES = ["self", "external_manual"] as const;
export type ManualExecutionMode = (typeof MANUAL_EXECUTION_MODES)[number];

export const MANUAL_EXECUTION_STATUSES = [
  "running",
  "waiting_for_input",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ManualExecutionStatus =
  (typeof MANUAL_EXECUTION_STATUSES)[number];
export type TerminalExecutionStatus = Extract<
  ManualExecutionStatus,
  "completed" | "failed" | "cancelled"
>;

export const VERIFICATION_SOURCES = [
  "unverified",
  "agent_reported",
  "runner_verified",
  "ci_verified",
  "human_verified",
] as const;
export type VerificationSource = (typeof VERIFICATION_SOURCES)[number];

export const ARTIFACT_KINDS = [
  "file",
  "url",
  "commit",
  "patch",
  "log",
  "report",
  "other",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const TEST_STATUSES = ["passed", "failed", "skipped", "not_run"] as const;
export type TestStatus = (typeof TEST_STATUSES)[number];

export const CHANGE_SET_KINDS = ["commit", "patch", "branch", "other"] as const;
export type ChangeSetKind = (typeof CHANGE_SET_KINDS)[number];

export const ISSUE_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface ManualExecution {
  readonly id: string;
  readonly workItemId: string;
  readonly graphVersion: number;
  readonly mode: ManualExecutionMode;
  readonly executorMemberId: string;
  readonly status: ManualExecutionStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly endedAt: string | null;
  readonly waitingReason: string | null;
  readonly endReason: string | null;
  readonly version: number;
}

export interface StartManualExecutionInput {
  readonly id: string;
  readonly workItemId: string;
  readonly graphVersion: number;
  readonly mode: ManualExecutionMode;
  readonly executorMemberId: string;
  readonly startedAt: string | Date;
}

export interface ChangeSetReference {
  readonly kind: ChangeSetKind;
  readonly reference: string;
}

export interface ArtifactReferenceInput {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly name: string;
  readonly uri: string;
  readonly mediaType?: string;
  readonly digest?: {
    readonly algorithm: "sha256";
    readonly value: string;
  };
  readonly sizeBytes?: number;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export interface ArtifactReference {
  readonly id: string;
  readonly kind: ArtifactKind;
  readonly name: string;
  readonly uri: string;
  readonly mediaType: string | null;
  readonly digest: {
    readonly algorithm: "sha256";
    readonly value: string;
  } | null;
  readonly sizeBytes: number | null;
  readonly metadata: Readonly<Record<string, JsonValue>>;
}

export interface TestResultReferenceInput {
  readonly id: string;
  readonly name: string;
  readonly status: TestStatus;
  readonly command?: string;
  readonly details?: string;
  readonly artifactIds?: readonly string[];
}

export interface TestResultReference {
  readonly id: string;
  readonly name: string;
  readonly status: TestStatus;
  readonly command: string | null;
  readonly details: string | null;
  readonly artifactIds: readonly string[];
}

export interface KnownIssueInput {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly severity: IssueSeverity;
  readonly blocking: boolean;
}

export interface KnownIssue {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly severity: IssueSeverity;
  readonly blocking: boolean;
}

export interface HumanDecisionInput {
  readonly question: string;
  readonly context: string;
  readonly options?: readonly string[];
}

export interface HumanDecision {
  readonly question: string;
  readonly context: string;
  readonly options: readonly string[];
}

export interface SessionReferenceInput {
  readonly provider: string;
  readonly externalSessionId: string;
  readonly machineId?: string;
  readonly workspacePath?: string;
}

export interface SessionReference {
  readonly provider: string;
  readonly externalSessionId: string;
  readonly machineId: string | null;
  readonly workspacePath: string | null;
}

export interface MoneyInput {
  readonly currency: string;
  readonly minorUnits: number;
}

export interface Money {
  readonly currency: string;
  readonly minorUnits: number;
}

export interface ResultContractInput {
  readonly id: string;
  readonly summary: string;
  readonly changedFiles?: readonly string[];
  readonly changeSet?: ChangeSetReference;
  readonly commitReference?: string;
  readonly tests?: readonly TestResultReferenceInput[];
  readonly artifacts?: readonly ArtifactReferenceInput[];
  readonly knownIssues?: readonly KnownIssueInput[];
  readonly needsHumanDecision?: boolean;
  readonly humanDecision?: HumanDecisionInput;
  readonly sessionReference?: SessionReferenceInput;
  readonly actualCost?: MoneyInput;
  readonly durationMs?: number;
  readonly verificationSource: VerificationSource;
}

export interface ExecutionResult {
  readonly id: string;
  readonly executionId: string;
  readonly workItemId: string;
  readonly outcome: TerminalExecutionStatus;
  readonly summary: string;
  readonly changedFiles: readonly string[];
  readonly changeSet: ChangeSetReference | null;
  readonly commitReference: string | null;
  readonly tests: readonly TestResultReference[];
  readonly artifacts: readonly ArtifactReference[];
  readonly knownIssues: readonly KnownIssue[];
  readonly needsHumanDecision: boolean;
  readonly humanDecision: HumanDecision | null;
  readonly sessionReference: SessionReference | null;
  readonly actualCost: Money | null;
  readonly durationMs: number | null;
  readonly verificationSource: VerificationSource;
  readonly createdAt: string;
}

export interface FinishManualExecutionInput {
  readonly executionId: string;
  readonly expectedVersion: number;
  readonly outcome: TerminalExecutionStatus;
  readonly endedAt: string | Date;
  readonly endReason?: string;
  readonly result: ResultContractInput;
}

export interface ManualExecutionStartGuardInput {
  readonly workItemId: string;
  readonly graphVersion: number;
  readonly executorMemberId: string;
}

export interface ManualExecutionStartGuard {
  assertCanStart(input: ManualExecutionStartGuardInput): void | Promise<void>;
}
