export type RequirementStatus =
  | "draft"
  | "in_progress"
  | "blocked"
  | "waiting_review"
  | "ready_for_release"
  | "completed";

export type WorkItemStatus =
  | "draft"
  | "ready"
  | "running"
  | "waiting_review"
  | "rework"
  | "blocked"
  | "completed"
  | "cancelled";

export type TimelineEventType =
  | "state_change"
  | "execution"
  | "result"
  | "review"
  | "artifact"
  | "test"
  | "comment"
  | "gate";

export interface PersonRef {
  id: string;
  name: string;
  initials: string;
}

export interface ResponsibilityChain {
  accountableHuman: PersonRef;
  operationalOwner: PersonRef;
  assignee: PersonRef;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  goal: string;
  activeRequirementCount: number;
  attentionCount: number;
  progress: number;
  targetRelease: string;
}

export interface Requirement {
  id: string;
  key: string;
  projectId: string;
  title: string;
  objective: string;
  status: RequirementStatus;
  progress: number;
  requiredCompleted: number;
  requiredTotal: number;
  owner: PersonRef;
  updatedAt: string;
}

export interface GraphNode {
  id: string;
  workItemId: string;
  title: string;
  kind: "work" | "gate";
  phase: string;
  status: WorkItemStatus;
  required: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "hard_dependency" | "rework";
}

export interface WorkGraph {
  requirementId: string;
  version: number;
  criticalPath: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Artifact {
  id: string;
  name: string;
  kind: "commit" | "document" | "test_report" | "build";
  reference: string;
  verifiedBy: "human_verified" | "ci_verified" | "unverified";
}

export interface TestEvidence {
  id: string;
  name: string;
  status: "passed" | "failed";
  summary: string;
}

export interface Result {
  id: string;
  executionId: string;
  summary: string;
  changedFiles: string[];
  artifacts: Artifact[];
  tests: TestEvidence[];
  knownIssues: string[];
  needsHumanDecision: boolean;
  submittedAt: string;
}

export interface Execution {
  id: string;
  attempt: number;
  mode: "self" | "external_manual";
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  result?: Result;
}

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  title: string;
  summary: string;
  actor: PersonRef;
  occurredAt: string;
  entityVersion: number;
  rawLog?: string;
}

export interface WorkItem {
  id: string;
  key: string;
  requirementId: string;
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  phase: string;
  status: WorkItemStatus;
  version: number;
  responsibilities: ResponsibilityChain;
  executions: Execution[];
  timeline: TimelineEvent[];
}

export interface ReleaseCheck {
  id: string;
  label: string;
  detail: string;
  status: "passed" | "warning" | "blocked";
}

export interface Release {
  id: string;
  name: string;
  projectId: string;
  targetAt: string;
  status: "assembling" | "waiting_approval" | "approved" | "released";
  requirementIds: string[];
  checks: ReleaseCheck[];
  rollbackPlan: string;
  approver: PersonRef;
  approvedAt?: string;
}

export interface AttentionItem {
  id: string;
  severity: "decision" | "warning" | "blocked";
  title: string;
  detail: string;
  targetLabel: string;
  href: string;
}

export interface WorkspaceSnapshot {
  organizationName: string;
  mode: "phase_0";
  projects: Project[];
  requirements: Requirement[];
  graphs: WorkGraph[];
  workItems: WorkItem[];
  releases: Release[];
  attention: AttentionItem[];
  recentEvents: TimelineEvent[];
  generatedAt: string;
}

export interface ResultInput {
  summary: string;
  changedFiles: string[];
  artifactReference: string;
  testSummary: string;
  knownIssues: string[];
  needsHumanDecision: boolean;
}

export interface ReviewInput {
  decision: "approve" | "reject";
  note: string;
}

export interface ReleaseApprovalInput {
  note: string;
}

export interface LiveEvent {
  id: string;
  type: "workspace.updated" | "heartbeat";
  occurredAt: string;
  entityId?: string;
}
