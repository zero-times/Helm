import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpHelmClient } from "./http-client";

const orgId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const requirementId = "00000000-0000-4000-8000-000000000003";
const workItemId = "00000000-0000-4000-8000-000000000004";
const memberId = "00000000-0000-4000-8000-000000000005";
const executionId = "00000000-0000-4000-8000-000000000006";

interface BackendState {
  executions?: unknown[];
  results?: unknown[];
  reviews?: unknown[];
  gates?: unknown[];
  reworks?: unknown[];
}

afterEach(() => vi.unstubAllGlobals());

describe("HttpHelmClient", () => {
  it("hydrates the real API resources into the management workspace", async () => {
    installFetch();
    const snapshot = await new HttpHelmClient("http://helm.test").loadWorkspace();

    expect(snapshot.organizationName).toBe("Helm Org");
    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.requirements[0]).toMatchObject({ id: requirementId, requiredTotal: 1 });
    expect(snapshot.workItems[0]).toMatchObject({ id: workItemId, status: "ready", version: 3 });
    expect(snapshot.releases[0]).toMatchObject({ id: requirementId, status: "waiting_approval" });
  });

  it("starts a real execution and advances the WorkItem with optimistic concurrency", async () => {
    const calls = installFetch();
    const client = new HttpHelmClient("http://helm.test");
    await client.beginExecution(workItemId, 3);

    const commands = calls.filter((call) => call.init?.method === "POST");
    expect(commands.map((call) => call.path)).toEqual([
      `/api/work-items/${workItemId}/executions`,
      `/api/work-items/${workItemId}/transition`,
    ]);
    expect(new Headers(commands[1]?.init?.headers).get("If-Match")).toBe("3");
  });

  it("submits a structured Result through the running Execution", async () => {
    const calls = installFetch({
      executions: [{
        id: executionId,
        workItemId,
        graphVersion: 1,
        mode: "self",
        status: "running",
        startedAt: "2026-08-11T01:00:00.000Z",
        endedAt: null,
        version: 2,
      }],
    });
    const client = new HttpHelmClient("http://helm.test");
    await client.submitResult(workItemId, 3, {
      summary: "Implemented",
      changedFiles: ["apps/web/src/App.tsx"],
      artifactReference: "abc123",
      testSummary: "All tests passed",
      knownIssues: [],
      needsHumanDecision: false,
    });

    const finish = calls.find((call) => call.path === `/api/executions/${executionId}/finish`);
    expect(JSON.parse(String(finish?.init?.body))).toMatchObject({
      expectedVersion: 2,
      outcome: "completed",
      result: { summary: "Implemented", commitReference: "abc123" },
    });
  });

  it("creates, approves, and completes a reviewed WorkItem", async () => {
    const calls = installFetch({
      executions: [{
        id: executionId,
        workItemId,
        graphVersion: 1,
        mode: "self",
        status: "completed",
        startedAt: "2026-08-11T01:00:00.000Z",
        endedAt: "2026-08-11T01:05:00.000Z",
        version: 2,
      }],
    });
    const client = new HttpHelmClient("http://helm.test");
    await client.reviewResult(workItemId, 3, { decision: "approve", note: "Accepted" });

    const commands = calls.filter((call) => call.init?.method === "POST");
    expect(commands.map((call) => call.path)).toEqual([
      `/api/executions/${executionId}/reviews`,
      "/api/reviews/00000000-0000-4000-8000-000000000007/approve",
      `/api/work-items/${workItemId}/transition`,
    ]);
  });

  it("waits for review after a rework Result instead of reusing the rejected review", async () => {
    installFetch({
      executions: [
        {
          id: "00000000-0000-4000-8000-000000000010",
          workItemId,
          graphVersion: 1,
          mode: "self",
          status: "completed",
          startedAt: "2026-08-11T01:00:00.000Z",
          endedAt: "2026-08-11T01:05:00.000Z",
          version: 2,
        },
        {
          id: executionId,
          workItemId,
          graphVersion: 1,
          mode: "self",
          status: "completed",
          startedAt: "2026-08-11T01:06:00.000Z",
          endedAt: "2026-08-11T01:10:00.000Z",
          version: 2,
        },
      ],
      reviews: [{
        id: "00000000-0000-4000-8000-000000000011",
        executionId: "00000000-0000-4000-8000-000000000010",
        status: "rejected",
        version: 2,
      }],
      reworks: [{
        id: "00000000-0000-4000-8000-000000000012",
        status: "started",
        version: 2,
      }],
    });

    const snapshot = await new HttpHelmClient("http://helm.test").loadWorkspace();

    expect(snapshot.workItems[0]?.status).toBe("waiting_review");
  });
});

function installFetch(state: BackendState = {}) {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ path: url.pathname, init });
    if (init?.method === "POST") {
      if (url.pathname.endsWith("/reviews")) {
        return json({
          review: { id: "00000000-0000-4000-8000-000000000007", executionId, status: "pending", version: 1 },
          gate: { id: "00000000-0000-4000-8000-000000000008", reviewId: "00000000-0000-4000-8000-000000000007", status: "pending", version: 1 },
        });
      }
      return json({});
    }
    if (url.pathname === "/api/organizations") return json([{ id: orgId, name: "Helm Org" }]);
    if (url.pathname === "/api/projects") return json([{
      id: projectId,
      slug: "helm",
      name: "Helm",
      description: "Agent-native delivery",
      accountableHumanId: memberId,
      operationalOwnerId: memberId,
    }]);
    if (url.pathname === "/api/members") return json([{ id: memberId, name: "Human Owner" }]);
    if (url.pathname === "/api/requirements") return json([{
      id: requirementId,
      projectId,
      goal: "Ship Phase 0",
      acceptanceCriteria: ["Happy path works"],
      status: "planned",
      accountableHumanId: memberId,
      operationalOwnerId: memberId,
      assigneeMemberId: memberId,
      updatedAt: "2026-08-11T01:00:00.000Z",
    }]);
    if (url.pathname.endsWith("/work-graph")) return json({
      id: "00000000-0000-4000-8000-000000000009",
      requirementId,
      graphVersion: 1,
      nodes: [{
        id: "00000000-0000-4000-8000-000000000010",
        key: "implement",
        title: "Implement",
        isRequired: true,
        workItemId,
        status: "ready",
        entityVersion: 3,
      }],
      edges: [],
    });
    if (url.pathname.endsWith("/executions")) return json({
      executions: state.executions ?? [],
      results: state.results ?? [],
    });
    if (url.pathname.endsWith("/reviews")) return json({
      reviews: state.reviews ?? [],
      gates: state.gates ?? [],
      reworks: state.reworks ?? [],
    });
    if (url.pathname.endsWith("/release-gate")) return json({ allowed: true, blockingBugIds: [] });
    if (url.pathname === "/api/v1/timeline") return json({ events: [] });
    return new Response(null, { status: 404 });
  }));
  return calls;
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
