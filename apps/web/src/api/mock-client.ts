import { createDemoSnapshot } from "../data/demo";
import type {
  CreateProjectInput,
  CreateRequirementInput,
  CreateWorkGraphInput,
  LiveEvent,
  Project,
  ReleaseApprovalInput,
  Requirement,
  Result,
  ResultInput,
  ReviewInput,
  TimelineEvent,
  UpdateProjectInput,
  UpdateRequirementInput,
  WorkGraph,
  WorkItem,
  WorkspaceSnapshot,
} from "../domain";
import type { ConnectionState, HelmClient } from "./client";

const actor = { id: "member-wang", name: "王同学", initials: "王" };

export class MockHelmClient implements HelmClient {
  private snapshot = createDemoSnapshot();
  private readonly createdRequirementCriteria = new Map<string, string[]>();

  async loadWorkspace(): Promise<WorkspaceSnapshot> {
    return structuredClone(this.snapshot);
  }

  async createRequirement(input: CreateRequirementInput): Promise<Requirement> {
    const reqId = `req-${crypto.randomUUID().slice(0, 8)}`;
    const index = this.snapshot.requirements.length + 1;
    const project = this.snapshot.projects.find((p) => p.id === input.projectId);
    const memberById = new Map(this.snapshot.members.map((m) => [m.id, m]));
    const person = (id: string) => memberById.get(id) ?? { id, name: "Unknown", initials: "?" };
    const requirement: Requirement = {
      id: reqId,
      key: `${project?.key ?? "REQ"}-${index}`,
      projectId: input.projectId,
      title: input.goal,
      objective: input.goal,
      status: "draft",
      progress: 0,
      requiredCompleted: 0,
      requiredTotal: 0,
      accountableHuman: person(input.accountableHumanId),
      operationalOwner: person(input.operationalOwnerId),
      assignee: person(input.assigneeMemberId),
      owner: person(input.accountableHumanId),
      acceptanceCriteria: [...input.acceptanceCriteria],
      updatedAt: new Date().toISOString(),
    };
    this.snapshot.requirements.push(requirement);
    this.createdRequirementCriteria.set(reqId, [...input.acceptanceCriteria]);
    // update project stats
    const proj = this.snapshot.projects.find((p) => p.id === input.projectId);
    if (proj) {
      proj.activeRequirementCount += 1;
    }
    this.touchWorkspace(reqId);
    return structuredClone(requirement);
  }

  async createWorkGraph(requirementId: string, input: CreateWorkGraphInput): Promise<WorkGraph> {
    const requirement = this.snapshot.requirements.find((r) => r.id === requirementId);
    if (!requirement) throw new Error("需求不存在。");

    const nodes = input.nodes.map((node, idx) => {
      const nodeId = `node-${crypto.randomUUID().slice(0, 8)}`;
      const wiId = `wi-${crypto.randomUUID().slice(0, 8)}`;
      const workItem: WorkItem = {
        id: wiId,
        key: `WORK-${100 + this.snapshot.workItems.length + idx}`,
        requirementId,
        title: node.title,
        objective: requirement.objective,
        acceptanceCriteria: this.createdRequirementCriteria.get(requirementId) ?? [requirement.objective],
        phase: node.isRequired ? "Required" : "Optional",
        status: "draft",
        version: 1,
        responsibilities: {
          accountableHuman: requirement.accountableHuman,
          operationalOwner: requirement.operationalOwner,
          assignee: requirement.assignee,
        },
        executions: [],
        timeline: [],
      };
      this.snapshot.workItems.push(workItem);
      return {
        id: nodeId,
        workItemId: wiId,
        title: node.title,
        kind: "work" as const,
        phase: node.isRequired ? "Required" : "Optional",
        status: "draft" as const,
        required: node.isRequired,
      };
    });

    const nodeByKey = new Map(input.nodes.map((n, i) => [n.key, nodes[i]]));
    const edges = input.edges.map((edge) => ({
      id: `edge-${crypto.randomUUID().slice(0, 8)}`,
      source: nodeByKey.get(edge.sourceKey)?.id ?? edge.sourceKey,
      target: nodeByKey.get(edge.targetKey)?.id ?? edge.targetKey,
      kind: "hard_dependency" as const,
    }));

    const graph: WorkGraph = {
      requirementId,
      version: 1,
      criticalPath: nodes.filter((n) => n.required).map((n) => n.workItemId),
      nodes,
      edges,
    };
    this.snapshot.graphs.push(graph);

    // Make the first node ready
    const firstNode = nodes[0];
    if (firstNode) {
      const wi = this.snapshot.workItems.find((w) => w.id === firstNode.workItemId);
      if (wi) {
        wi.status = "ready";
        wi.version += 1;
      }
    }

    // update requirement stats
    const requiredNodes = nodes.filter((n) => n.required);
    requirement.requiredTotal = requiredNodes.length;
    requirement.requiredCompleted = 0;

    this.touchWorkspace(requirementId);
    return structuredClone(graph);
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const projectId = `project-${input.slug.slice(0, 20)}`;
    const memberById = new Map(this.snapshot.members.map((m) => [m.id, m]));
    const person = (id: string) => memberById.get(id) ?? { id, name: "Unknown", initials: "?" };
    const project: Project = {
      id: projectId,
      key: input.slug.toUpperCase(),
      name: input.name,
      goal: input.description,
      slug: input.slug,
      description: input.description,
      accountableHuman: person(input.accountableHumanId),
      operationalOwner: person(input.operationalOwnerId),
      activeRequirementCount: 0,
      attentionCount: 0,
      progress: 0,
      targetRelease: "Phase 0",
    };
    this.snapshot.projects.push(project);
    this.touchWorkspace(projectId);
    return structuredClone(project);
  }

  async updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
    const project = this.snapshot.projects.find((p) => p.id === id);
    if (!project) throw new Error("项目不存在。");
    const memberById = new Map(this.snapshot.members.map((m) => [m.id, m]));
    const person = (memberId: string) => memberById.get(memberId) ?? { id: memberId, name: "Unknown", initials: "?" };

    if (input.name !== undefined) project.name = input.name;
    if (input.slug !== undefined) {
      project.slug = input.slug;
      project.key = input.slug.toUpperCase();
    }
    if (input.description !== undefined) {
      project.description = input.description;
      project.goal = input.description;
    }
    if (input.accountableHumanId !== undefined) {
      project.accountableHuman = person(input.accountableHumanId);
    }
    if (input.operationalOwnerId !== undefined) {
      project.operationalOwner = person(input.operationalOwnerId);
    }

    this.touchWorkspace(id);
    return structuredClone(project);
  }

  async deleteProject(id: string): Promise<void> {
    const hasRequirements = this.snapshot.requirements.some((req) => req.projectId === id);
    if (hasRequirements) throw new Error("项目仍有需求，无法删除。请先移除项目下的所有需求。");
    const index = this.snapshot.projects.findIndex((p) => p.id === id);
    if (index === -1) throw new Error("项目不存在。");
    this.snapshot.projects.splice(index, 1);
    this.touchWorkspace(id);
  }

  async updateRequirement(id: string, input: UpdateRequirementInput): Promise<Requirement> {
    const requirement = this.snapshot.requirements.find((r) => r.id === id);
    if (!requirement) throw new Error("需求不存在。");
    const memberById = new Map(this.snapshot.members.map((m) => [m.id, m]));
    const person = (memberId: string) => memberById.get(memberId) ?? { id: memberId, name: "Unknown", initials: "?" };

    if (input.goal !== undefined) {
      requirement.title = input.goal;
      requirement.objective = input.goal;
    }
    if (input.acceptanceCriteria !== undefined) {
      requirement.acceptanceCriteria = [...input.acceptanceCriteria];
    }
    if (input.accountableHumanId !== undefined) {
      requirement.accountableHuman = person(input.accountableHumanId);
    }
    if (input.operationalOwnerId !== undefined) {
      requirement.operationalOwner = person(input.operationalOwnerId);
    }
    if (input.assigneeMemberId !== undefined) {
      requirement.assignee = person(input.assigneeMemberId);
    }
    requirement.updatedAt = new Date().toISOString();

    this.touchWorkspace(id);
    return structuredClone(requirement);
  }

  async deleteRequirement(id: string): Promise<void> {
    const requirement = this.snapshot.requirements.find((r) => r.id === id);
    if (!requirement) throw new Error("需求不存在。");
    const hasGraph = this.snapshot.graphs.some((g) => g.requirementId === id);
    if (hasGraph) throw new Error("需求已有工作图，无法删除。工作图包含执行历史和 Timeline，删除会导致审计链不完整。");
    const reqIndex = this.snapshot.requirements.findIndex((r) => r.id === id);
    if (reqIndex !== -1) this.snapshot.requirements.splice(reqIndex, 1);
    this.touchWorkspace(id);
  }

  async beginExecution(workItemId: string, expectedVersion: number): Promise<void> {
    const item = this.getWorkItem(workItemId, expectedVersion);
    if (item.status !== "ready" && item.status !== "rework") {
      throw new Error("只有已就绪或待返工的任务可以开始执行。");
    }

    const attempt = item.executions.length + 1;
    item.executions.push({
      id: `execution-${workItemId}-${attempt}`,
      attempt,
      mode: "self",
      status: "running",
      startedAt: new Date().toISOString(),
    });
    this.transition(item, "running", "人工执行已开始", `第 ${attempt} 次执行由 ${actor.name} 开始。`, "execution");
  }

  async submitResult(workItemId: string, expectedVersion: number, input: ResultInput): Promise<void> {
    const item = this.getWorkItem(workItemId, expectedVersion);
    const execution = item.executions.at(-1);
    if (!execution || execution.status !== "running") {
      throw new Error("没有可提交结果的运行中执行。");
    }

    const submittedAt = new Date().toISOString();
    const result: Result = {
      id: `result-${crypto.randomUUID()}`,
      executionId: execution.id,
      summary: input.summary,
      changedFiles: input.changedFiles,
      artifacts: input.artifactReference
        ? [
            {
              id: `artifact-${crypto.randomUUID()}`,
              name: "提交 / 变更引用",
              kind: "commit",
              reference: input.artifactReference,
              verifiedBy: "human_verified",
            },
          ]
        : [],
      tests: input.testSummary
        ? [
            {
              id: `test-${crypto.randomUUID()}`,
              name: "人工验证",
              status: "passed",
              summary: input.testSummary,
            },
          ]
        : [],
      knownIssues: input.knownIssues,
      needsHumanDecision: input.needsHumanDecision,
      submittedAt,
    };
    execution.status = "completed";
    execution.completedAt = submittedAt;
    execution.result = result;
    this.transition(item, "waiting_review", "结构化 Result 已提交", input.summary, "result");
  }

  async reviewResult(workItemId: string, expectedVersion: number, input: ReviewInput): Promise<void> {
    const item = this.getWorkItem(workItemId, expectedVersion);
    if (item.status !== "waiting_review") throw new Error("当前任务没有等待审核的结果。");

    if (input.decision === "approve") {
      this.transition(item, "completed", "Result 已通过", input.note, "review");
      this.advanceGraph(item);
    } else {
      this.transition(item, "rework", "Result 被退回返工", input.note, "review");
    }
  }

  async addComment(workItemId: string, expectedVersion: number, body: string): Promise<void> {
    const item = this.getWorkItem(workItemId, expectedVersion);
    item.version += 1;
    item.timeline.unshift(this.event(item, "comment", "补充说明", body));
    this.touchWorkspace(item.id);
  }

  async approveRelease(releaseId: string, input: ReleaseApprovalInput): Promise<void> {
    const release = this.snapshot.releases.find((candidate) => candidate.id === releaseId);
    if (!release) throw new Error("未找到发布版本。");
    if (release.checks.some((check) => check.status === "blocked")) {
      throw new Error("仍有阻塞检查，无法授权发布。");
    }

    release.status = "approved";
    release.approvedAt = new Date().toISOString();
    const event: TimelineEvent = {
      id: `event-${crypto.randomUUID()}`,
      type: "gate",
      title: `${release.name} 已获发布授权`,
      summary: input.note,
      actor,
      occurredAt: release.approvedAt,
      entityVersion: 13,
    };
    this.snapshot.recentEvents.unshift(event);
    this.snapshot.attention = this.snapshot.attention.filter((item) => item.id !== "attention-release");
    this.touchWorkspace(release.id);
  }

  subscribe(
    onEvent: (event: LiveEvent) => void,
    onConnectionChange: (state: ConnectionState) => void,
  ): () => void {
    onConnectionChange({ state: "connecting" });
    const connected = window.setTimeout(() => {
      onConnectionChange({ state: "live", lastEventAt: new Date().toISOString() });
    }, 250);
    const heartbeat = window.setInterval(() => {
      const event: LiveEvent = {
        id: crypto.randomUUID(),
        type: "heartbeat",
        occurredAt: new Date().toISOString(),
      };
      onConnectionChange({ state: "live", lastEventAt: event.occurredAt });
      onEvent(event);
    }, 20_000);

    return () => {
      window.clearTimeout(connected);
      window.clearInterval(heartbeat);
    };
  }

  private getWorkItem(id: string, expectedVersion: number): WorkItem {
    const item = this.snapshot.workItems.find((candidate) => candidate.id === id);
    if (!item) throw new Error("未找到任务。");
    if (item.version !== expectedVersion) {
      throw new Error("任务已被其他操作更新，请刷新后重试。");
    }
    return item;
  }

  private transition(
    item: WorkItem,
    status: WorkItem["status"],
    title: string,
    summary: string,
    type: TimelineEvent["type"],
  ): void {
    item.status = status;
    item.version += 1;
    const event = this.event(item, type, title, summary);
    item.timeline.unshift(event);
    this.snapshot.recentEvents.unshift(event);
    const graph = this.snapshot.graphs.find((candidate) => candidate.requirementId === item.requirementId);
    const node = graph?.nodes.find((candidate) => candidate.workItemId === item.id);
    if (node) node.status = status;
    this.touchWorkspace(item.id);
  }

  private event(
    item: WorkItem,
    type: TimelineEvent["type"],
    title: string,
    summary: string,
  ): TimelineEvent {
    return {
      id: `event-${crypto.randomUUID()}`,
      type,
      title,
      summary,
      actor,
      occurredAt: new Date().toISOString(),
      entityVersion: item.version,
    };
  }

  private advanceGraph(item: WorkItem): void {
    const graph = this.snapshot.graphs.find((candidate) => candidate.requirementId === item.requirementId);
    if (!graph) return;
    const completedNode = graph.nodes.find((candidate) => candidate.workItemId === item.id);
    if (!completedNode) return;
    const nextEdge = graph.edges.find((edge) => edge.source === completedNode.id && edge.kind === "hard_dependency");
    const nextNode = graph.nodes.find((node) => node.id === nextEdge?.target);
    const nextItem = this.snapshot.workItems.find((candidate) => candidate.id === nextNode?.workItemId);
    if (nextNode && nextItem && nextItem.status === "draft") {
      nextNode.status = "ready";
      nextItem.status = "ready";
      nextItem.version += 1;
      nextItem.timeline.unshift(
        this.event(nextItem, "state_change", "任务已就绪", "上游任务通过审核，硬依赖已满足。"),
      );
    }
  }

  private touchWorkspace(entityId: string): void {
    this.snapshot.generatedAt = new Date().toISOString();
    const event: LiveEvent = {
      id: crypto.randomUUID(),
      type: "workspace.updated",
      occurredAt: this.snapshot.generatedAt,
      entityId,
    };
    void event;
  }
}
