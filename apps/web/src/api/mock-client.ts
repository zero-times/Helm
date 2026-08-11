import { createDemoSnapshot } from "../data/demo";
import type {
  LiveEvent,
  ReleaseApprovalInput,
  Result,
  ResultInput,
  ReviewInput,
  TimelineEvent,
  WorkItem,
  WorkspaceSnapshot,
} from "../domain";
import type { ConnectionState, HelmClient } from "./client";

const actor = { id: "member-wang", name: "王同学", initials: "王" };

export class MockHelmClient implements HelmClient {
  private snapshot = createDemoSnapshot();

  async loadWorkspace(): Promise<WorkspaceSnapshot> {
    return structuredClone(this.snapshot);
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

