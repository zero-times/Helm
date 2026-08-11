export const BUG_DISCOVERY_STAGES = [
  "requirement",
  "design",
  "implementation",
  "review",
  "qa",
  "release",
  "production",
] as const;
export type BugDiscoveryStage = (typeof BUG_DISCOVERY_STAGES)[number];

export const BUG_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];

export const BUG_STATUSES = [
  "open",
  "fix_in_progress",
  "awaiting_qa",
  "closed",
] as const;
export type BugStatus = (typeof BUG_STATUSES)[number];

export const QA_REGRESSION_STATUSES = ["pending", "passed", "failed"] as const;
export type QaRegressionStatus = (typeof QA_REGRESSION_STATUSES)[number];

export const BUG_REPORTER_ROLES = [
  "qa",
  "engineering",
  "product",
  "operations",
] as const;
export type BugReporterRole = (typeof BUG_REPORTER_ROLES)[number];

export interface BugWorkItem {
  readonly id: string;
  readonly sourceRequirementId: string;
  readonly graphVersion: number;
  readonly title: string;
  readonly description: string;
  readonly discoveredIn: BugDiscoveryStage;
  readonly severity: BugSeverity;
  readonly blocking: boolean;
  readonly reporterMemberId: string;
  readonly status: BugStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt: string | null;
  readonly version: number;
}

export interface BugFixEdge {
  readonly id: string;
  readonly bugId: string;
  readonly executionId: string;
  readonly resultId: string;
  readonly reviewId: string;
  readonly passedGateId: string;
  readonly fixedAt: string;
}

export interface QaRegressionEdge {
  readonly id: string;
  readonly bugId: string;
  readonly fixEdgeId: string;
  readonly qaMemberId: string;
  readonly status: QaRegressionStatus;
  readonly requestedAt: string;
  readonly completedAt: string | null;
  readonly notes: string | null;
  readonly version: number;
}

export interface CreateBugInput {
  readonly id: string;
  readonly sourceRequirementId: string;
  readonly graphVersion: number;
  readonly title: string;
  readonly description: string;
  readonly discoveredIn: BugDiscoveryStage;
  readonly severity: BugSeverity;
  readonly blocking: boolean;
  readonly reporterMemberId: string;
  readonly reporterRole: BugReporterRole;
  readonly createdAt: string | Date;
}

export interface StartBugFixInput {
  readonly bugId: string;
  readonly expectedBugVersion: number;
  readonly occurredAt: string | Date;
}

export interface PassedReviewGateInput {
  readonly gateId: string;
  readonly workItemId: string;
  readonly graphVersion: number;
}

/** Adapter port implemented by HELM-5's HumanGatePolicy. */
export interface PassedReviewGateReader {
  assertReviewedWorkItemCanComplete(input: PassedReviewGateInput):
    | Promise<void>
    | void;
}

export interface SubmitFixForQaInput {
  readonly bugId: string;
  readonly expectedBugVersion: number;
  readonly fixEdgeId: string;
  readonly executionId: string;
  readonly resultId: string;
  readonly reviewId: string;
  readonly passedGateId: string;
  readonly regressionEdgeId: string;
  readonly qaMemberId: string;
  readonly occurredAt: string | Date;
}

export interface CompleteQaRegressionInput {
  readonly regressionEdgeId: string;
  readonly expectedRegressionVersion: number;
  readonly expectedBugVersion: number;
  readonly outcome: "passed" | "failed";
  readonly notes?: string;
  readonly occurredAt: string | Date;
}

export interface BugBlockingEvaluation {
  readonly allowed: boolean;
  readonly blockingBugIds: readonly string[];
}

export interface RequirementGuardInput {
  readonly requirementId: string;
}
