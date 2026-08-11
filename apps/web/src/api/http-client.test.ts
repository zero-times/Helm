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
  memberName?: string;
}

afterEach(() => vi.unstubAllGlobals());

describe("HttpHelmClient", () => {
  it("hydrates the real API resources into the management workspace", async () => {
    installFetch();
    const snapshot = await new HttpHelmClient("http://helm.test").loadWorkspace();

    expect(snapshot.organizationName).toBe("Helm Org");
    expect(snapshot.members).toHaveLength(1);
    expect(snapshot.members[0]).toMatchObject({ id: memberId, name: "Human Owner" });
    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.requirements[0]).toMatchObject({ id: requirementId, requiredTotal: 1 });
    expect(snapshot.requirements[0].accountableHuman.id).toBe(memberId);
    expect(snapshot.requirements[0].operationalOwner.id).toBe(memberId);
    expect(snapshot.requirements[0].assignee.id).toBe(memberId);
    expect(snapshot.workItems[0]).toMatchObject({ id: workItemId, status: "ready", version: 3 });
    expect(snapshot.releases[0]).toMatchObject({ id: requirementId, status: "waiting_approval" });
  });

  it("starts SSE after the hydrated timeline position instead of replaying history", async () => {
    installFetch();
    const opened: string[] = [];
    class FakeEventSource {
      onopen: (() => void) | null = null;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string | URL) { opened.push(String(url)); }
      close() {}
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    const client = new HttpHelmClient("http://helm.test");
    await client.loadWorkspace();

    const unsubscribe = client.subscribe(() => {}, () => {});
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    const streamUrl = new URL(opened[0]!);
    expect(streamUrl.searchParams.get("afterPosition")).toBe("42");
    unsubscribe();
  });

  it("turns generated principal identifiers into stable pending-name labels", async () => {
    installFetch({ memberName: "Human Principal 25b1ca94" });
    const snapshot = await new HttpHelmClient("http://helm.test").loadWorkspace();

    expect(snapshot.members[0]?.name).toBe("成员 01（待实名）");
    expect(snapshot.requirements[0]?.owner.name).toBe("成员 01（待实名）");
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

  it("creates a requirement and accepts the server's compact work-graph response", async () => {
    const calls = installFetch();
    const client = new HttpHelmClient("http://helm.test");
    const requirement = await client.createRequirement({
      projectId,
      goal: "Create a usable flow",
      acceptanceCriteria: ["The flow works"],
      accountableHumanId: memberId,
      operationalOwnerId: memberId,
      assigneeMemberId: memberId,
    });
    const graph = await client.createWorkGraph(requirement.id, {
      nodes: [{ key: "implement", title: "Implement", isRequired: true }],
      edges: [],
    });

    expect(requirement.id).toBe(requirementId);
    expect(graph).toMatchObject({ requirementId, version: 1, nodes: [], edges: [] });
    expect(calls.filter((call) => call.init?.method === "POST").map((call) => call.path)).toEqual([
      "/api/requirements",
      `/api/requirements/${requirementId}/work-graph`,
    ]);
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

  it("creates a project using the organization id obtained internally", async () => {
    const calls = installFetch();
    const client = new HttpHelmClient("http://helm.test");
    const project = await client.createProject({
      name: "New Project",
      slug: "new-project",
      description: "Test description",
      accountableHumanId: memberId,
      operationalOwnerId: memberId,
    });

    expect(project.name).toBe("New Project");
    expect(project.key).toBe("NEW-PROJECT");
    expect(project.slug).toBe("new-project");
    expect(calls.some((call) => call.path === "/api/projects" && call.init?.method === "POST")).toBe(true);
  });

  it("updates a project with PATCH and returns the mapped domain object", async () => {
    const calls = installFetch();
    const client = new HttpHelmClient("http://helm.test");
    const project = await client.updateProject(projectId, { name: "Updated" });

    expect(project.name).toBe("Updated");
    const patchCall = calls.find((call) => call.path === `/api/projects/${projectId}` && call.init?.method === "PATCH");
    expect(patchCall).toBeTruthy();
  });

  it("deletes a project with DELETE and handles 204", async () => {
    installFetch();
    const client = new HttpHelmClient("http://helm.test");
    await expect(client.deleteProject(projectId)).resolves.toBeUndefined();
  });

  it("updates a requirement with PATCH", async () => {
    const calls = installFetch();
    const client = new HttpHelmClient("http://helm.test");
    const req = await client.updateRequirement(requirementId, {
      goal: "Updated goal",
      acceptanceCriteria: ["Criterion 1"],
    });

    expect(req.title).toBe("Updated goal");
    const patchCall = calls.find((call) => call.path === `/api/requirements/${requirementId}` && call.init?.method === "PATCH");
    expect(patchCall).toBeTruthy();
  });

  it("deletes a requirement with DELETE and handles 204", async () => {
    installFetch();
    const client = new HttpHelmClient("http://helm.test");
    await expect(client.deleteRequirement(requirementId)).resolves.toBeUndefined();
  });

  it("surfaces backend error messages from 409 responses", async () => {
    let requestCount = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      requestCount++;
      return new Response(JSON.stringify({ message: "项目仍有需求，无法删除" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }));
    const client = new HttpHelmClient("http://helm.test");
    await expect(client.deleteProject("any-id")).rejects.toThrow("项目仍有需求，无法删除");
  });
});

function installFetch(state: BackendState = {}) {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push({ path: url.pathname, init });
    if (init?.method === "POST") {
      if (url.pathname === "/api/requirements") {
        return json({
          id: requirementId,
          projectId,
          goal: "Create a usable flow",
          acceptanceCriteria: ["The flow works"],
          status: "planned",
          accountableHumanId: memberId,
          operationalOwnerId: memberId,
          assigneeMemberId: memberId,
          updatedAt: "2026-08-11T01:00:00.000Z",
        });
      }
      if (url.pathname === `/api/requirements/${requirementId}/work-graph`) {
        return json({
          id: "00000000-0000-4000-8000-000000000009",
          requirementId,
          graphVersion: 1,
          createdAt: "2026-08-11T01:00:00.000Z",
          updatedAt: "2026-08-11T01:00:00.000Z",
        });
      }
      if (url.pathname === "/api/projects") {
        const body = JSON.parse(String(init.body));
        return json({
          id: projectId,
          slug: body.slug ?? "new-project",
          name: body.name ?? "New Project",
          description: body.description ?? "",
          accountableHumanId: body.accountableHumanId ?? memberId,
          operationalOwnerId: body.operationalOwnerId ?? memberId,
        });
      }
      if (url.pathname.endsWith("/reviews")) {
        return json({
          review: { id: "00000000-0000-4000-8000-000000000007", executionId, status: "pending", version: 1 },
          gate: { id: "00000000-0000-4000-8000-000000000008", reviewId: "00000000-0000-4000-8000-000000000007", status: "pending", version: 1 },
        });
      }
      return json({});
    }
    if (init?.method === "PATCH") {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      if (url.pathname.startsWith("/api/projects/")) {
        return json({
          id: projectId,
          slug: body.slug ?? "existing-slug",
          name: body.name ?? "Existing Name",
          description: body.description ?? "Existing description",
          accountableHumanId: body.accountableHumanId ?? memberId,
          operationalOwnerId: body.operationalOwnerId ?? memberId,
        });
      }
      if (url.pathname.startsWith("/api/requirements/")) {
        return json({
          id: requirementId,
          projectId,
          goal: body.goal ?? "Updated goal",
          acceptanceCriteria: body.acceptanceCriteria ?? ["Criterion 1"],
          status: "planned",
          accountableHumanId: body.accountableHumanId ?? memberId,
          operationalOwnerId: body.operationalOwnerId ?? memberId,
          assigneeMemberId: body.assigneeMemberId ?? memberId,
          updatedAt: "2026-08-11T01:00:00.000Z",
        });
      }
      return json({});
    }
    if (init?.method === "DELETE") {
      return new Response(null, { status: 204 });
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
    if (url.pathname === "/api/members") return json([{ id: memberId, name: state.memberName ?? "Human Owner" }]);
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
    if (url.pathname === "/api/v1/timeline") return json({ events: [], nextPosition: 42 });
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
