import { describe, expect, it, vi } from "vitest";
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
});
