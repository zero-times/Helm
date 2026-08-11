import type {
  Artifact,
  Execution,
  LiveEvent,
  PersonRef,
  ReleaseApprovalInput,
  RequirementStatus,
  Result,
  ResultInput,
  ReviewInput,
  TimelineEvent,
  TimelineEventType,
  WorkItemStatus,
  WorkspaceSnapshot,
} from "../domain";
import type { ConnectionState, HelmClient } from "./client";

interface ApiOrganization { id: string; name: string }
interface ApiMember { id: string; name: string }
interface ApiProject {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  accountableHumanId: string;
  operationalOwnerId: string;
}
interface ApiRequirement {
  id: string;
  projectId: string;
  goal: string;
  acceptanceCriteria: string[];
  status: "planned" | "in_progress" | "blocked" | "completed" | "canceled";
  accountableHumanId: string;
  operationalOwnerId: string;
  assigneeMemberId: string;
  updatedAt: string;
}
interface ApiGraphNode {
  id: string;
  key: string;
  title: string;
  isRequired: boolean;
  workItemId: string;
  status: "pending" | "ready" | "in_progress" | "completed" | "failed" | "canceled";
  entityVersion: number;
}
interface ApiGraphEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  isHardDependency: boolean;
}
interface ApiGraph {
  id: string;
  requirementId: string;
  graphVersion: number;
  nodes: ApiGraphNode[];
  edges: ApiGraphEdge[];
}
interface ApiExecution {
  id: string;
  workItemId: string;
  graphVersion: number;
  mode: "self" | "external_manual";
  status: "running" | "waiting_for_input" | "completed" | "failed" | "cancelled";
  startedAt: string;
  endedAt: string | null;
  version: number;
}
interface ApiResult {
  id: string;
  executionId: string;
  summary: string;
  changedFiles: string[];
  commitReference: string | null;
  tests: Array<{ id: string; name: string; status: string; details: string | null }>;
  artifacts: Array<{ id: string; name: string; kind: string; uri: string; verificationSource?: string }>;
  knownIssues: Array<{ title: string; description: string }>;
  needsHumanDecision: boolean;
  verificationSource: string;
  createdAt: string;
}
interface ApiReview {
  id: string;
  executionId: string;
  status: "pending" | "approved" | "rejected";
  version: number;
}
interface ApiGate { id: string; reviewId: string; status: "pending" | "passed" | "rework_required"; version: number }
interface ApiRework { id: string; status: "requested" | "started"; version: number }
interface ApiTimelineEvent {
  globalPosition: number;
  timelineEventId: string;
  entityType: string;
  entityId: string;
  workItemId?: string;
  category: string;
  summary: string;
  details: Record<string, unknown>;
  actorMemberId: string;
  source: string;
  entityVersion: number;
  occurredAt: string;
}
interface WorkItemApiContext {
  graphVersion: number;
  node: ApiGraphNode;
  requirement: ApiRequirement;
  executions: ApiExecution[];
  results: ApiResult[];
  reviews: ApiReview[];
  gates: ApiGate[];
  reworks: ApiRework[];
}

export class HttpHelmClient implements HelmClient {
  private organizationId: string | null = null;
  private readonly workItemContexts = new Map<string, WorkItemApiContext>();

  constructor(private readonly baseUrl: string) {}

  async loadWorkspace(): Promise<WorkspaceSnapshot> {
    const organizations = await this.request<ApiOrganization[]>("/api/organizations");
    const organization = organizations[0];
    if (!organization) return emptyWorkspace();
    this.organizationId = organization.id;

    const [projects, members, timelineResponse] = await Promise.all([
      this.request<ApiProject[]>(`/api/projects?organizationId=${organization.id}`),
      this.request<ApiMember[]>(`/api/members?organizationId=${organization.id}`),
      this.request<{ events: ApiTimelineEvent[] }>(
        `/api/v1/timeline?organizationId=${organization.id}&limit=250`,
      ),
    ]);
    const memberById = new Map(members.map((member) => [member.id, member]));
    const requirements = (
      await Promise.all(
        projects.map((project) =>
          this.request<ApiRequirement[]>(`/api/requirements?projectId=${project.id}`),
        ),
      )
    ).flat();
    const graphs = (
      await Promise.all(
        requirements.map((requirement) =>
          this.optional<ApiGraph>(`/api/requirements/${requirement.id}/work-graph`),
        ),
      )
    ).filter((graph): graph is ApiGraph => graph !== null);

    const contexts = await Promise.all(
      graphs.flatMap((graph) => {
        const requirement = requirements.find((candidate) => candidate.id === graph.requirementId)!;
        return graph.nodes.map(async (node): Promise<[string, WorkItemApiContext]> => {
          const [executionData, reviewData] = await Promise.all([
            this.request<{ executions: ApiExecution[]; results: ApiResult[] }>(
              `/api/work-items/${node.workItemId}/executions`,
            ),
            this.request<{ reviews: ApiReview[]; gates: ApiGate[]; reworks: ApiRework[] }>(
              `/api/work-items/${node.workItemId}/reviews`,
            ),
          ]);
          return [node.workItemId, {
            graphVersion: graph.graphVersion,
            node,
            requirement,
            ...executionData,
            ...reviewData,
          }];
        });
      }),
    );
    this.workItemContexts.clear();
    for (const [id, context] of contexts) this.workItemContexts.set(id, context);

    const gateEvaluations = new Map(
      await Promise.all(
        requirements.map(async (requirement) => [
          requirement.id,
          await this.request<{ allowed: boolean; blockingBugIds: string[] }>(
            `/api/requirements/${requirement.id}/release-gate`,
          ),
        ] as const),
      ),
    );
    const person = (id: string): PersonRef => toPerson(memberById.get(id), id);
    const timeline = timelineResponse.events.map((event) => toTimelineEvent(event, person));
    const graphByRequirement = new Map(graphs.map((graph) => [graph.requirementId, graph]));
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const requirementViews = requirements.map((requirement, index) => {
      const graph = graphByRequirement.get(requirement.id);
      const requiredNodes = graph?.nodes.filter((node) => node.isRequired) ?? [];
      const completed = requiredNodes.filter((node) => node.status === "completed").length;
      const progress = requiredNodes.length ? Math.round((completed / requiredNodes.length) * 100) : 0;
      const project = projectById.get(requirement.projectId);
      return {
        id: requirement.id,
        key: `${project?.slug.toUpperCase() ?? "REQ"}-${index + 1}`,
        projectId: requirement.projectId,
        title: requirement.goal,
        objective: requirement.goal,
        status: mapRequirementStatus(requirement.status, completed, requiredNodes.length),
        progress,
        requiredCompleted: completed,
        requiredTotal: requiredNodes.length,
        owner: person(requirement.accountableHumanId),
        updatedAt: requirement.updatedAt,
      };
    });
    const requirementViewById = new Map(requirementViews.map((requirement) => [requirement.id, requirement]));
    const workItems = graphs.flatMap((graph) => {
      const requirement = requirements.find((candidate) => candidate.id === graph.requirementId)!;
      return graph.nodes.map((node) => {
        const context = this.workItemContexts.get(node.workItemId)!;
        return {
          id: node.workItemId,
          key: node.key,
          requirementId: requirement.id,
          title: node.title,
          objective: requirement.goal,
          acceptanceCriteria: requirement.acceptanceCriteria,
          phase: node.isRequired ? "Required" : "Optional",
          status: deriveWorkItemStatus(context),
          version: node.entityVersion,
          responsibilities: {
            accountableHuman: person(requirement.accountableHumanId),
            operationalOwner: person(requirement.operationalOwnerId),
            assignee: person(requirement.assigneeMemberId),
          },
          executions: mapExecutions(context),
          timeline: timeline.filter((event) =>
            timelineResponse.events.find(
              (raw) => raw.timelineEventId === event.id && raw.workItemId === node.workItemId,
            ),
          ),
        };
      });
    });
    const graphViews = graphs.map((graph) => ({
      requirementId: graph.requirementId,
      version: graph.graphVersion,
      criticalPath: graph.nodes.filter((node) => node.isRequired).map((node) => node.workItemId),
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        workItemId: node.workItemId,
        title: node.title,
        kind: "work" as const,
        phase: node.isRequired ? "Required" : "Optional",
        status: deriveWorkItemStatus(this.workItemContexts.get(node.workItemId)!),
        required: node.isRequired,
      })),
      edges: graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        kind: "hard_dependency" as const,
      })),
    }));
    const releases = requirements.map((requirement) => {
      const view = requirementViewById.get(requirement.id)!;
      const gate = gateEvaluations.get(requirement.id)!;
      const authorized = timelineResponse.events.find(
        (event) => event.entityType === "release" && event.entityId === requirement.id,
      );
      const graphReady = view.requiredTotal > 0 && view.requiredCompleted === view.requiredTotal;
      return {
        id: requirement.id,
        name: `${projectById.get(requirement.projectId)?.name ?? "Project"} · ${view.key}`,
        projectId: requirement.projectId,
        targetAt: new Date().toISOString(),
        status: authorized ? "approved" as const : "waiting_approval" as const,
        requirementIds: [requirement.id],
        checks: [
          {
            id: `${requirement.id}-work`,
            label: "必需节点",
            detail: graphReady ? "全部完成" : `${view.requiredCompleted}/${view.requiredTotal} 已完成`,
            status: graphReady ? "passed" as const : "blocked" as const,
          },
          {
            id: `${requirement.id}-bugs`,
            label: "阻塞缺陷",
            detail: gate.allowed ? "没有未关闭的阻塞 Bug" : `${gate.blockingBugIds.length} 个阻塞 Bug`,
            status: gate.allowed ? "passed" as const : "blocked" as const,
          },
        ],
        rollbackPlan: "回滚到上一已验证版本，并保留本次审计与 Result 证据。",
        approver: person(requirement.accountableHumanId),
        approvedAt: authorized?.occurredAt,
      };
    });
    const attention = workItems
      .filter((item) => item.status === "waiting_review" || item.status === "blocked" || item.status === "rework")
      .map((item) => ({
        id: `attention-${item.id}`,
        severity: item.status === "blocked" ? "blocked" as const : "decision" as const,
        title: item.title,
        detail: item.status === "waiting_review" ? "Result 等待人工审核" : "需要处理后才能继续",
        targetLabel: item.key,
        href: `/work-items/${item.id}`,
      }));

    return {
      organizationName: organization.name,
      mode: "phase_0",
      projects: projects.map((project) => {
        const projectRequirements = requirementViews.filter((item) => item.projectId === project.id);
        const progress = projectRequirements.length
          ? Math.round(projectRequirements.reduce((sum, item) => sum + item.progress, 0) / projectRequirements.length)
          : 0;
        return {
          id: project.id,
          key: project.slug.toUpperCase(),
          name: project.name,
          goal: project.description ?? project.name,
          activeRequirementCount: projectRequirements.filter((item) => item.status !== "completed").length,
          attentionCount: attention.filter((item) =>
            workItems.find((workItem) => workItem.id === item.id.replace("attention-", ""))?.requirementId &&
            projectRequirements.some((requirement) =>
              requirement.id === workItems.find((workItem) => workItem.id === item.id.replace("attention-", ""))?.requirementId,
            ),
          ).length,
          progress,
          targetRelease: "Phase 0",
        };
      }),
      requirements: requirementViews,
      graphs: graphViews,
      workItems,
      releases,
      attention,
      recentEvents: timeline.slice(-12).reverse(),
      generatedAt: new Date().toISOString(),
    };
  }

  async beginExecution(workItemId: string, expectedVersion: number): Promise<void> {
    const context = await this.contextFor(workItemId);
    const requestedRework = [...context.reworks].reverse().find((rework) => rework.status === "requested");
    if (requestedRework) {
      await this.command(`/api/rework-requests/${requestedRework.id}/start`, {
        expectedVersion: requestedRework.version,
        mode: "self",
        executorMemberId: context.requirement.assigneeMemberId,
      });
      return;
    }
    await this.command(`/api/work-items/${workItemId}/executions`, {
      graphVersion: context.graphVersion,
      mode: "self",
      executorMemberId: context.requirement.assigneeMemberId,
    });
    await this.command(`/api/work-items/${workItemId}/transition`, {
      toStatus: "in_progress",
      expectedGraphVersion: context.graphVersion,
    }, expectedVersion);
  }

  async submitResult(workItemId: string, _expectedVersion: number, input: ResultInput): Promise<void> {
    const context = await this.contextFor(workItemId);
    const execution = [...context.executions].reverse().find(
      (candidate) => candidate.status === "running" || candidate.status === "waiting_for_input",
    );
    if (!execution) throw new Error("没有可提交 Result 的运行中 Execution。");
    await this.command(`/api/executions/${execution.id}/finish`, {
      expectedVersion: execution.version,
      outcome: "completed",
      result: {
        summary: input.summary,
        changedFiles: input.changedFiles,
        ...(input.artifactReference ? { commitReference: input.artifactReference } : {}),
        tests: input.testSummary ? [{
          id: crypto.randomUUID(),
          name: "人工验证",
          status: "passed",
          details: input.testSummary,
        }] : [],
        knownIssues: input.knownIssues.map((issue) => ({
          id: crypto.randomUUID(),
          title: issue,
          description: issue,
          severity: "low",
          blocking: false,
        })),
        needsHumanDecision: input.needsHumanDecision,
        verificationSource: "human_verified",
      },
    });
  }

  async reviewResult(workItemId: string, expectedVersion: number, input: ReviewInput): Promise<void> {
    const context = await this.contextFor(workItemId);
    const execution = [...context.executions].reverse().find((candidate) => candidate.status === "completed");
    if (!execution) throw new Error("没有可审核的已完成 Execution。");
    let review = [...context.reviews].reverse().find((candidate) => candidate.executionId === execution.id);
    let gate = review ? context.gates.find((candidate) => candidate.reviewId === review!.id) : undefined;
    if (!review || !gate) {
      const created = await this.command<{ review: ApiReview; gate: ApiGate }>(
        `/api/executions/${execution.id}/reviews`,
        { reviewerMemberId: context.requirement.accountableHumanId },
      );
      review = created.review;
      gate = created.gate;
    }
    await this.command(`/api/reviews/${review.id}/${input.decision === "approve" ? "approve" : "reject"}`, {
      expectedReviewVersion: review.version,
      expectedGateVersion: gate.version,
      ...(input.decision === "approve" ? { comment: input.note } : { reason: input.note }),
    });
    if (input.decision === "approve") {
      await this.command(`/api/work-items/${workItemId}/transition`, {
        toStatus: "completed",
        expectedGraphVersion: context.graphVersion,
      }, expectedVersion);
    }
  }

  addComment(workItemId: string, expectedVersion: number, body: string): Promise<void> {
    return this.command(`/api/v1/work-items/${workItemId}/comments`, { body }, expectedVersion);
  }

  approveRelease(releaseId: string, input: ReleaseApprovalInput): Promise<void> {
    return this.command(`/api/v1/releases/${releaseId}/gate`, { decision: "approve", ...input });
  }

  subscribe(
    onEvent: (event: LiveEvent) => void,
    onConnectionChange: (state: ConnectionState) => void,
  ): () => void {
    let events: EventSource | null = null;
    let closed = false;
    onConnectionChange({ state: "connecting" });
    void this.organization().then((organizationId) => {
      if (closed || !organizationId) return;
      const query = new URLSearchParams({ organizationId });
      events = new EventSource(`${this.baseUrl}/api/v1/events?${query}`);
      events.onopen = () => onConnectionChange({ state: "live", lastEventAt: new Date().toISOString() });
      events.onmessage = (message) => {
        const raw = JSON.parse(message.data) as ApiTimelineEvent;
        onConnectionChange({ state: "live", lastEventAt: raw.occurredAt });
        onEvent({ id: raw.timelineEventId, type: "workspace.updated", occurredAt: raw.occurredAt, entityId: raw.entityId });
      };
      events.onerror = () => onConnectionChange({ state: "reconnecting" });
    }).catch(() => onConnectionChange({ state: "offline" }));
    return () => {
      closed = true;
      events?.close();
    };
  }

  private async organization(): Promise<string | null> {
    if (this.organizationId) return this.organizationId;
    const organizations = await this.request<ApiOrganization[]>("/api/organizations");
    this.organizationId = organizations[0]?.id ?? null;
    return this.organizationId;
  }

  private async contextFor(workItemId: string): Promise<WorkItemApiContext> {
    if (!this.workItemContexts.has(workItemId)) await this.loadWorkspace();
    const context = this.workItemContexts.get(workItemId);
    if (!context) throw new Error("WorkItem 不属于当前工作区。");
    return context;
  }

  private command<T = void>(path: string, body: unknown, expectedVersion?: number): Promise<T> {
    return this.request<T>(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
        ...(expectedVersion === undefined ? {} : { "If-Match": String(expectedVersion) }),
      },
      body: JSON.stringify(body),
    });
  }

  private async optional<T>(path: string): Promise<T | null> {
    const response = await fetch(`${this.baseUrl}${path}`, { credentials: "same-origin" });
    if (response.status === 404) return null;
    return this.readResponse<T>(response);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, { credentials: "same-origin", ...init });
    return this.readResponse<T>(response);
  }

  private async readResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      throw new Error(payload?.message ?? `请求失败（${response.status}）`);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }
}

function toPerson(member: ApiMember | undefined, fallbackId: string): PersonRef {
  const name = member?.name ?? "Unknown";
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";
  return { id: member?.id ?? fallbackId, name, initials };
}

function mapRequirementStatus(
  status: ApiRequirement["status"],
  completed: number,
  total: number,
): RequirementStatus {
  if (status === "blocked") return "blocked";
  if (status === "completed") return "completed";
  if (completed > 0 && completed === total) return "ready_for_release";
  if (status === "in_progress") return "in_progress";
  return "draft";
}

function deriveWorkItemStatus(context: WorkItemApiContext): WorkItemStatus {
  if ([...context.reworks].reverse().some((rework) => rework.status === "requested")) return "rework";
  const latestExecution = context.executions.at(-1);
  const latestReview = [...context.reviews]
    .reverse()
    .find((review) => review.executionId === latestExecution?.id);
  if (latestExecution?.status === "running" || latestExecution?.status === "waiting_for_input") return "running";
  if (latestExecution?.status === "completed" && (!latestReview || latestReview.status === "pending")) return "waiting_review";
  if (context.node.status === "pending") return "draft";
  if (context.node.status === "failed") return "blocked";
  if (context.node.status === "canceled") return "cancelled";
  return context.node.status === "in_progress" ? "running" : context.node.status;
}

function mapExecutions(context: WorkItemApiContext): Execution[] {
  return context.executions.map((execution, index) => ({
    id: execution.id,
    attempt: index + 1,
    mode: execution.mode,
    status: execution.status === "waiting_for_input" ? "running" : execution.status,
    startedAt: execution.startedAt,
    ...(execution.endedAt ? { completedAt: execution.endedAt } : {}),
    result: mapResult(context.results.find((result) => result.executionId === execution.id)),
  }));
}

function mapResult(result: ApiResult | undefined): Result | undefined {
  if (!result) return undefined;
  return {
    id: result.id,
    executionId: result.executionId,
    summary: result.summary,
    changedFiles: result.changedFiles,
    artifacts: result.artifacts.map((artifact): Artifact => ({
      id: artifact.id,
      name: artifact.name,
      kind: artifact.kind === "commit" ? "commit" : artifact.kind === "report" ? "test_report" : "document",
      reference: artifact.uri,
      verifiedBy: result.verificationSource === "human_verified" ? "human_verified" : result.verificationSource === "ci_verified" ? "ci_verified" : "unverified",
    })),
    tests: result.tests.map((test) => ({
      id: test.id,
      name: test.name,
      status: test.status === "passed" ? "passed" : "failed",
      summary: test.details ?? test.name,
    })),
    knownIssues: result.knownIssues.map((issue) => issue.title || issue.description),
    needsHumanDecision: result.needsHumanDecision,
    submittedAt: result.createdAt,
  };
}

function toTimelineEvent(event: ApiTimelineEvent, person: (id: string) => PersonRef): TimelineEvent {
  const allowed = new Set<TimelineEventType>([
    "state_change", "execution", "result", "review", "artifact", "test", "comment", "gate",
  ]);
  const type = allowed.has(event.category as TimelineEventType)
    ? event.category as TimelineEventType
    : "state_change";
  return {
    id: event.timelineEventId,
    type,
    title: event.summary,
    summary: typeof event.details.body === "string" ? event.details.body : event.summary,
    actor: person(event.actorMemberId),
    occurredAt: event.occurredAt,
    entityVersion: event.entityVersion,
    rawLog: JSON.stringify({ source: event.source, details: event.details }, null, 2),
  };
}

function emptyWorkspace(): WorkspaceSnapshot {
  return {
    organizationName: "Helm",
    mode: "phase_0",
    projects: [],
    requirements: [],
    graphs: [],
    workItems: [],
    releases: [],
    attention: [],
    recentEvents: [],
    generatedAt: new Date().toISOString(),
  };
}
