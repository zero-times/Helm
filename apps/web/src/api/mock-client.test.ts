import { describe, expect, it, vi } from "vitest";
import { createHelmClient } from "./client";
import { HttpHelmClient } from "./http-client";
import { MockHelmClient } from "./mock-client";

describe("MockHelmClient", () => {
  it("runs the Phase 0 manual execution happy path without overwriting history", async () => {
    const client = new MockHelmClient();

    await client.beginExecution("wi-build", 8);
    let snapshot = await client.loadWorkspace();
    let workItem = snapshot.workItems.find((item) => item.id === "wi-build")!;

    expect(workItem.status).toBe("running");
    expect(workItem.executions).toHaveLength(1);
    expect(workItem.version).toBe(9);

    await client.submitResult("wi-build", 9, {
      summary: "完成扫码登录正常与过期路径。",
      changedFiles: ["src/login.ts", "src/login.test.ts"],
      artifactReference: "abc1234",
      testSummary: "12 项测试通过",
      knownIssues: ["低网速下首次轮询稍慢"],
      needsHumanDecision: false,
    });

    snapshot = await client.loadWorkspace();
    workItem = snapshot.workItems.find((item) => item.id === "wi-build")!;
    expect(workItem.status).toBe("waiting_review");
    expect(workItem.executions[0].result?.changedFiles).toEqual(["src/login.ts", "src/login.test.ts"]);
    expect(workItem.version).toBe(10);

    await client.reviewResult("wi-build", 10, {
      decision: "approve",
      note: "验收通过。",
    });

    snapshot = await client.loadWorkspace();
    workItem = snapshot.workItems.find((item) => item.id === "wi-build")!;
    const downstream = snapshot.workItems.find((item) => item.id === "wi-qa")!;
    expect(workItem.status).toBe("completed");
    expect(workItem.executions).toHaveLength(1);
    expect(workItem.executions[0].result?.summary).toBe("完成扫码登录正常与过期路径。");
    expect(downstream.status).toBe("ready");
  });

  it("rejects a result into rework and creates a new execution attempt", async () => {
    const client = new MockHelmClient();
    await client.beginExecution("wi-build", 8);
    await client.submitResult("wi-build", 9, {
      summary: "初版实现",
      changedFiles: [],
      artifactReference: "",
      testSummary: "",
      knownIssues: [],
      needsHumanDecision: false,
    });
    await client.reviewResult("wi-build", 10, { decision: "reject", note: "补充过期路径。" });

    let snapshot = await client.loadWorkspace();
    let workItem = snapshot.workItems.find((item) => item.id === "wi-build")!;
    expect(workItem.status).toBe("rework");
    expect(workItem.executions).toHaveLength(1);

    await client.beginExecution("wi-build", 11);
    snapshot = await client.loadWorkspace();
    workItem = snapshot.workItems.find((item) => item.id === "wi-build")!;
    expect(workItem.executions).toHaveLength(2);
    expect(workItem.executions[0].result?.summary).toBe("初版实现");
    expect(workItem.executions[1].attempt).toBe(2);
  });

  it("enforces optimistic versions on commands", async () => {
    const client = new MockHelmClient();
    await expect(client.beginExecution("wi-build", 7)).rejects.toThrow("任务已被其他操作更新");
  });

  it("records explicit release authorization and clears its attention item", async () => {
    const client = new MockHelmClient();
    await client.approveRelease("release-alpha", { note: "检查已完成，接受已记录风险。" });
    const snapshot = await client.loadWorkspace();
    expect(snapshot.releases[0].status).toBe("approved");
    expect(snapshot.releases[0].approvedAt).toBeTruthy();
    expect(snapshot.attention.some((item) => item.id === "attention-release")).toBe(false);
    expect(snapshot.recentEvents[0].type).toBe("gate");
  });

  it("reports live connection state in mock mode", () => {
    vi.useFakeTimers();
    const client = new MockHelmClient();
    const states: string[] = [];
    const unsubscribe = client.subscribe(
      () => undefined,
      (connection) => states.push(connection.state),
    );

    expect(states).toEqual(["connecting"]);
    vi.advanceTimersByTime(250);
    expect(states).toEqual(["connecting", "live"]);
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it("defaults to HttpHelmClient when VITE_DATA_MODE is not mock", () => {
    const original = (import.meta.env as Record<string, unknown>).VITE_DATA_MODE;
    delete (import.meta.env as Record<string, unknown>).VITE_DATA_MODE;

    const client = createHelmClient();
    expect(client).toBeInstanceOf(HttpHelmClient);

    if (original !== undefined) {
      (import.meta.env as Record<string, unknown>).VITE_DATA_MODE = original;
    }
  });

  it("creates MockHelmClient when VITE_DATA_MODE=mock is explicitly set", () => {
    const original = (import.meta.env as Record<string, unknown>).VITE_DATA_MODE;
    (import.meta.env as Record<string, unknown>).VITE_DATA_MODE = "mock";

    const client = createHelmClient();
    expect(client).toBeInstanceOf(MockHelmClient);

    (import.meta.env as Record<string, unknown>).VITE_DATA_MODE = original;
  });

  it("creates, updates, and deletes a project with correct shape", async () => {
    const client = new MockHelmClient();
    const project = await client.createProject({
      name: "New Project",
      slug: "new-project",
      description: "A test project",
      accountableHumanId: "member-wang",
      operationalOwnerId: "member-li",
    });

    expect(project.id).toMatch(/^project-/);
    expect(project.key).toBe("NEW-PROJECT");
    expect(project.slug).toBe("new-project");
    expect(project.name).toBe("New Project");
    expect(project.description).toBe("A test project");
    expect(project.accountableHuman?.name).toBe("王同学");
    expect(project.operationalOwner?.name).toBe("李工");

    // Update it
    const updated = await client.updateProject(project.id, {
      name: "Renamed Project",
      slug: "renamed-project",
    });
    expect(updated.name).toBe("Renamed Project");
    expect(updated.key).toBe("RENAMED-PROJECT");

    // Verify snapshot
    const snapshot = await client.loadWorkspace();
    const inSnapshot = snapshot.projects.find((p) => p.id === project.id)!;
    expect(inSnapshot.name).toBe("Renamed Project");
    expect(inSnapshot.slug).toBe("renamed-project");

    // Delete it (no requirements yet)
    await client.deleteProject(project.id);
    const afterDelete = await client.loadWorkspace();
    expect(afterDelete.projects.find((p) => p.id === project.id)).toBeUndefined();
  });

  it("blocks project deletion when requirements still exist", async () => {
    const client = new MockHelmClient();
    await expect(client.deleteProject("project-helm")).rejects.toThrow("项目仍有需求");
  });

  it("updates and deletes a requirement with correct shape", async () => {
    const client = new MockHelmClient();

    const updated = await client.updateRequirement("req-42", {
      goal: "Updated goal text",
      acceptanceCriteria: ["Criterion A", "Criterion B"],
      accountableHumanId: "member-li",
    });
    expect(updated.title).toBe("Updated goal text");
    expect(updated.objective).toBe("Updated goal text");
    expect(updated.acceptanceCriteria).toEqual(["Criterion A", "Criterion B"]);
    expect(updated.accountableHuman.name).toBe("李工");

    // Verify snapshot
    const snapshot = await client.loadWorkspace();
    const inSnapshot = snapshot.requirements.find((r) => r.id === "req-42")!;
    expect(inSnapshot.title).toBe("Updated goal text");
    expect(inSnapshot.acceptanceCriteria).toEqual(["Criterion A", "Criterion B"]);
  });

  it("blocks requirement deletion when a work graph exists", async () => {
    const client = new MockHelmClient();
    // req-42 has a graph
    await expect(client.deleteRequirement("req-42")).rejects.toThrow("工作图包含执行历史");
  });

  it("allows requirement deletion when no work graph exists", async () => {
    const client = new MockHelmClient();
    // req-site-7 has no graph
    const before = await client.loadWorkspace();
    expect(before.requirements.find((r) => r.id === "req-site-7")).toBeTruthy();

    await client.deleteRequirement("req-site-7");
    const after = await client.loadWorkspace();
    expect(after.requirements.find((r) => r.id === "req-site-7")).toBeUndefined();
  });

  it("creates a new requirement and returns it with correct shape", async () => {
    const client = new MockHelmClient();
    const requirement = await client.createRequirement({
      projectId: "project-helm",
      goal: "端到端测试基础设施",
      acceptanceCriteria: ["覆盖率 > 80%"],
      accountableHumanId: "member-wang",
      operationalOwnerId: "member-li",
      assigneeMemberId: "member-wang",
    });

    expect(requirement.id).toMatch(/^req-/);
    expect(requirement.projectId).toBe("project-helm");
    expect(requirement.title).toBe("端到端测试基础设施");
    expect(requirement.status).toBe("draft");
    expect(requirement.acceptanceCriteria).toEqual(["覆盖率 > 80%"]);

    const snapshot = await client.loadWorkspace();
    expect(snapshot.requirements.find((r) => r.id === requirement.id)).toBeTruthy();
  });

  it("creates a work graph for a requirement with sequential dependencies", async () => {
    const client = new MockHelmClient();
    const requirement = await client.createRequirement({
      projectId: "project-helm",
      goal: "CI/CD 流水线",
      acceptanceCriteria: ["构建时间 < 5 分钟"],
      accountableHumanId: "member-wang",
      operationalOwnerId: "member-li",
      assigneeMemberId: "member-wang",
    });

    const graph = await client.createWorkGraph(requirement.id, {
      nodes: [
        { key: "setup", title: "搭建 CI 环境", isRequired: true },
        { key: "pipeline", title: "编写流水线脚本", isRequired: true },
        { key: "verify", title: "验证构建结果", isRequired: false },
      ],
      edges: [
        { sourceKey: "setup", targetKey: "pipeline", isHardDependency: true },
        { sourceKey: "pipeline", targetKey: "verify", isHardDependency: true },
      ],
    });

    expect(graph.requirementId).toBe(requirement.id);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    expect(graph.version).toBe(1);

    // First node should be ready
    const firstNode = graph.nodes[0];
    expect(firstNode.required).toBe(true);

    const snapshot = await client.loadWorkspace();
    const firstWi = snapshot.workItems.find((w) => w.id === firstNode.workItemId);
    expect(firstWi?.status).toBe("ready");

    // Requirement stats updated
    const updatedReq = snapshot.requirements.find((r) => r.id === requirement.id);
    expect(updatedReq?.requiredTotal).toBe(2);
    expect(updatedReq?.requiredCompleted).toBe(0);
  });
});
