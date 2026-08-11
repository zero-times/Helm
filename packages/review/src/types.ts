import type {
  ManualExecution,
  ManualExecutionMode,
} from "../../execution/src/index.ts";

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const HUMAN_GATE_STATUSES = [
  "pending",
  "passed",
  "rework_required",
] as const;
export type HumanGateStatus = (typeof HUMAN_GATE_STATUSES)[number];

export const REWORK_STATUSES = ["requested", "started"] as const;
export type ReworkStatus = (typeof REWORK_STATUSES)[number];

export interface Review {
  readonly id: string;
  readonly resultId: string;
  readonly executionId: string;
  readonly workItemId: string;
  readonly graphVersion: number;
  readonly reviewerMemberId: string;
  readonly status: ReviewStatus;
  readonly requestedAt: string;
  readonly decidedAt: string | null;
  readonly decisionComment: string | null;
  readonly version: number;
}

export interface HumanGate {
  readonly id: string;
  readonly reviewId: string;
  readonly workItemId: string;
  readonly graphVersion: number;
  readonly status: HumanGateStatus;
  readonly openedAt: string;
  readonly resolvedAt: string | null;
  readonly version: number;
}

export interface ReworkRequest {
  readonly id: string;
  readonly rejectedReviewId: string;
  readonly previousExecutionId: string;
  readonly previousResultId: string;
  readonly workItemId: string;
  readonly graphVersion: number;
  readonly reason: string;
  readonly status: ReworkStatus;
  readonly requestedAt: string;
  readonly newExecutionId: string | null;
  readonly startedAt: string | null;
  readonly version: number;
}

export interface RequestReviewInput {
  readonly reviewId: string;
  readonly gateId: string;
  readonly executionId: string;
  readonly reviewerMemberId: string;
  readonly requestedAt: string | Date;
}

export interface DecideReviewInput {
  readonly reviewId: string;
  readonly expectedReviewVersion: number;
  readonly expectedGateVersion: number;
  readonly occurredAt: string | Date;
}

export interface ApproveReviewInput extends DecideReviewInput {
  readonly comment?: string;
}

export interface RejectReviewInput extends DecideReviewInput {
  readonly reworkRequestId: string;
  readonly reason: string;
}

export interface StartReworkInput {
  readonly reworkRequestId: string;
  readonly expectedVersion: number;
  readonly executionId: string;
  readonly mode: ManualExecutionMode;
  readonly executorMemberId: string;
  readonly startedAt: string | Date;
}

export interface GateEvaluation {
  readonly ready: boolean;
  readonly blockingGateIds: readonly string[];
}

export interface ReviewedCompletionInput {
  readonly gateId: string;
  readonly workItemId: string;
  readonly graphVersion: number;
}

export interface StartedRework {
  readonly rework: ReworkRequest;
  readonly execution: ManualExecution;
}
