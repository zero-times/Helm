import { expect, type APIRequestContext, test } from "@playwright/test";

const apiBaseUrl = "http://127.0.0.1:3100";

interface Phase0Fixture {
  organizationId: string;
  humanId: string;
  projectId: string;
  requirementId: string;
  graphVersion: number;
  workItemId: string;
}

test.describe.serial("Phase 0 release acceptance", () => {
  let fixture: Phase0Fixture;

  test.beforeAll(async ({ request }) => {
    fixture = await seedPhase0(request);
  });

  test("one Human completes reject, rework, blocking Bug, QA, and release authorization", async ({
    page,
    request,
  }) => {
    await page.goto(`/work-items/${fixture.workItemId}`);
    await expect(page.getByRole("heading", { name: "Implement Phase 0" })).toBeVisible();

    await page.getByRole("button", { name: "开始人工执行" }).click();
    await expect(page.getByRole("heading", { name: "回填结构化 Result" })).toBeVisible();
    await page.locator('textarea[placeholder^="完成了什么"]').fill("First implementation");
    await page.locator('textarea[placeholder="每行一个文件路径"]').fill("apps/server/src/app.ts");
    await page.locator('textarea[placeholder^="执行的命令"]').fill("pnpm check passed");
    await page.getByRole("button", { name: "提交审核" }).click();

    await expect(page.getByRole("heading", { name: "审核本次 Result" })).toBeVisible();
    await page.locator('textarea[placeholder^="说明通过依据"]').fill("Add release regression evidence");
    await page.getByRole("button", { name: "退回返工" }).click();

    await expect(page.getByRole("heading", { name: "开始新的返工执行" })).toBeVisible();
    await page.getByRole("button", { name: "开始返工" }).click();
    await expect(page.getByRole("heading", { name: "回填结构化 Result" })).toBeVisible();
    await page.locator('textarea[placeholder^="完成了什么"]').fill("Reworked implementation with release evidence");
    await page.locator('textarea[placeholder="每行一个文件路径"]').fill("e2e/phase0-release.spec.ts");
    await page.locator('textarea[placeholder^="执行的命令"]').fill("Playwright release acceptance passed");
    await page.getByRole("button", { name: "提交审核" }).click();

    await expect(page.getByRole("heading", { name: "审核本次 Result" })).toBeVisible();
    await page.locator('textarea[placeholder^="说明通过依据"]').fill("Regression evidence accepted");
    await page.getByRole("button", { name: "通过" }).click();
    await expect(page.getByRole("heading", { name: "任务已通过" })).toBeVisible();
    await expect(page.getByRole("region", { name: "执行历史" })).toContainText("#2");

    const history = await getJson<{
      executions: Array<{ id: string; status: string }>;
      results: Array<{ id: string; executionId: string }>;
    }>(request, `/api/work-items/${fixture.workItemId}/executions`);
    const reviews = await getJson<{
      reviews: Array<{ id: string; executionId: string; status: string }>;
      gates: Array<{ id: string; reviewId: string; status: string }>;
      reworks: Array<{ previousResultId: string; newExecutionId: string }>;
    }>(request, `/api/work-items/${fixture.workItemId}/reviews`);
    expect(history.executions.map((execution) => execution.status)).toEqual(["completed", "completed"]);
    expect(reviews.reviews.map((review) => review.status)).toEqual(["rejected", "approved"]);
    expect(reviews.reworks).toHaveLength(1);
    expect(reviews.reworks[0]?.previousResultId).toBe(history.results[0]?.id);
    expect(reviews.reworks[0]?.newExecutionId).toBe(history.executions[1]?.id);

    const replayKey = `release-evidence-${crypto.randomUUID()}`;
    const firstComment = await request.post(`${apiBaseUrl}/api/v1/work-items/${fixture.workItemId}/comments`, {
      headers: { "If-Match": "3", "Idempotency-Key": replayKey },
      data: { body: "Release evidence reviewed." },
    });
    expect(firstComment.ok()).toBe(true);
    const replayedComment = await request.post(`${apiBaseUrl}/api/v1/work-items/${fixture.workItemId}/comments`, {
      headers: { "If-Match": "3", "Idempotency-Key": replayKey },
      data: { body: "Release evidence reviewed." },
    });
    expect(replayedComment.ok()).toBe(true);
    expect(await replayedComment.json()).toEqual(await firstComment.json());

    const staleWrite = await request.post(`${apiBaseUrl}/api/work-items/${fixture.workItemId}/transition`, {
      headers: { "If-Match": "1", "Idempotency-Key": `stale-${crypto.randomUUID()}` },
      data: { toStatus: "failed", expectedGraphVersion: fixture.graphVersion },
    });
    expect(staleWrite.status()).toBe(409);
    await expect(staleWrite.json()).resolves.toMatchObject({
      error: "OPTIMISTIC_CONCURRENCY_CONFLICT",
    });

    const latestExecution = history.executions[1]!;
    const latestResult = history.results.find((result) => result.executionId === latestExecution.id)!;
    const approvedReview = reviews.reviews.find((review) => review.status === "approved")!;
    const passedGate = reviews.gates.find((gate) => gate.reviewId === approvedReview.id)!;
    const bug = await postJson<{ id: string; version: number }>(
      request,
      `/api/requirements/${fixture.requirementId}/bugs`,
      {
        graphVersion: fixture.graphVersion,
        title: "Release drops audit evidence",
        description: "QA found missing evidence on the release path.",
        discoveredIn: "qa",
        severity: "critical",
        blocking: true,
        reporterMemberId: fixture.humanId,
      },
      201,
    );

    await page.goto("/releases");
    const releaseCard = page.locator(
      `article.release-card[data-release-id="${fixture.requirementId}"]`,
    );
    await expect(releaseCard.getByText("1 个阻塞 Bug")).toBeVisible();
    await expect(releaseCard.getByRole("button", { name: "明确授权发布" })).toBeDisabled();

    const fixingBug = await postJson<{ version: number }>(
      request,
      `/api/bugs/${bug.id}/start-fix`,
      { expectedBugVersion: bug.version },
    );
    const submitted = await postJson<{
      bug: { version: number };
      regression: { id: string; version: number };
    }>(request, `/api/bugs/${bug.id}/submit-fix`, {
      expectedBugVersion: fixingBug.version,
      executionId: latestExecution.id,
      resultId: latestResult.id,
      reviewId: approvedReview.id,
      passedGateId: passedGate.id,
      qaMemberId: fixture.humanId,
    }, 201);
    await postJson(request, `/api/qa-regressions/${submitted.regression.id}/complete`, {
      expectedRegressionVersion: submitted.regression.version,
      expectedBugVersion: submitted.bug.version,
      outcome: "passed",
      notes: "Release audit evidence is preserved.",
    });

    await page.reload();
    await expect(releaseCard.getByText("没有未关闭的阻塞 Bug")).toBeVisible();
    await releaseCard
      .locator('textarea[placeholder^="记录授权依据"]')
      .fill("All Phase 0 evidence accepted.");
    await releaseCard.getByRole("button", { name: "明确授权发布" }).click();
    await expect(releaseCard.getByRole("heading", { name: "发布已获授权" })).toBeVisible();

    const workItemAudit = await getJson<{ events: Array<{ eventType: string }> }>(
      request,
      `/api/v1/domain-events?organizationId=${fixture.organizationId}&workItemId=${fixture.workItemId}`,
    );
    expect(workItemAudit.events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "Review.Rejected",
        "Rework.Started",
        "Review.Approved",
        "WorkItem.CommentAdded",
      ]),
    );
    expect(
      workItemAudit.events.filter((event) => event.eventType === "WorkItem.CommentAdded"),
    ).toHaveLength(1);
    const releaseAudit = await getJson<{ events: Array<{ eventType: string }> }>(
      request,
      `/api/v1/domain-events?organizationId=${fixture.organizationId}&entityType=release&entityId=${fixture.requirementId}`,
    );
    expect(releaseAudit.events.map((event) => event.eventType)).toContain("Release.Authorized");
  });

  test("canceling an upstream node propagates through hard dependencies", async ({ request }) => {
    const requirement = await postJson<{ id: string }>(request, "/api/requirements", {
      projectId: fixture.projectId,
      goal: "Cancel an obsolete delivery path",
      acceptanceCriteria: ["Every downstream required node is canceled"],
      accountableHumanId: fixture.humanId,
      operationalOwnerId: fixture.humanId,
      assigneeMemberId: fixture.humanId,
    }, 201);
    await postJson(request, `/api/requirements/${requirement.id}/work-graph`, {
      nodes: [
        { key: "plan", title: "Plan" },
        { key: "build", title: "Build" },
        { key: "release", title: "Release" },
      ],
      edges: [
        { sourceKey: "plan", targetKey: "build" },
        { sourceKey: "build", targetKey: "release" },
      ],
    }, 201);
    const graph = await getJson<{
      graphVersion: number;
      nodes: Array<{ key: string; workItemId: string; status: string }>;
    }>(request, `/api/requirements/${requirement.id}/work-graph`);
    const plan = graph.nodes.find((node) => node.key === "plan")!;
    const canceled = await request.post(`${apiBaseUrl}/api/work-items/${plan.workItemId}/transition`, {
      headers: { "If-Match": "1", "Idempotency-Key": `cancel-${crypto.randomUUID()}` },
      data: { toStatus: "canceled", expectedGraphVersion: graph.graphVersion },
    });
    expect(canceled.ok()).toBe(true);
    await expect(canceled.json()).resolves.toMatchObject({
      status: "canceled",
      canceledDescendantWorkItemIds: expect.arrayContaining([
        graph.nodes.find((node) => node.key === "build")!.workItemId,
        graph.nodes.find((node) => node.key === "release")!.workItemId,
      ]),
    });

    const finalGraph = await getJson<{ nodes: Array<{ status: string }> }>(
      request,
      `/api/requirements/${requirement.id}/work-graph`,
    );
    expect(finalGraph.nodes.map((node) => node.status)).toEqual(["canceled", "canceled", "canceled"]);
    const finalRequirement = await getJson<{ status: string }>(request, `/api/requirements/${requirement.id}`);
    expect(finalRequirement.status).toBe("canceled");
  });
});

async function seedPhase0(request: APIRequestContext): Promise<Phase0Fixture> {
  const suffix = crypto.randomUUID();
  // The web workspace binds to the first organization in the database, and
  // domain records are append-only by design, so reuse that organization
  // instead of requiring a pristine database.
  const existing = await getJson<Array<{ id: string }>>(request, "/api/organizations");
  const organizationId = existing[0]?.id ?? (
    await postJson<{ id: string }>(request, "/api/organizations", {
      name: "Phase 0 Release Org",
      slug: `phase0-${suffix}`,
    }, 201)
  ).id;
  const human = await postJson<{ id: string }>(request, "/api/members", {
    organizationId,
    memberType: "human",
    name: `Human Principal ${suffix.slice(0, 8)}`,
  }, 201);
  const project = await postJson<{ id: string }>(request, "/api/projects", {
    organizationId,
    name: "Helm Phase 0",
    slug: `helm-phase0-${suffix}`,
    description: "One Human, zero Agent delivery loop",
    accountableHumanId: human.id,
    operationalOwnerId: human.id,
  }, 201);
  const requirement = await postJson<{ id: string }>(request, "/api/requirements", {
    projectId: project.id,
    goal: "Release the Phase 0 lifecycle",
    acceptanceCriteria: ["Reject and rework history remains immutable", "Blocking Bugs prevent release"],
    accountableHumanId: human.id,
    operationalOwnerId: human.id,
    assigneeMemberId: human.id,
  }, 201);
  await postJson(request, `/api/requirements/${requirement.id}/work-graph`, {
    nodes: [{ key: "implement", title: "Implement Phase 0" }],
    edges: [],
  }, 201);
  const graph = await getJson<{
    graphVersion: number;
    nodes: Array<{ workItemId: string }>;
  }>(request, `/api/requirements/${requirement.id}/work-graph`);
  return {
    organizationId,
    humanId: human.id,
    projectId: project.id,
    requirementId: requirement.id,
    graphVersion: graph.graphVersion,
    workItemId: graph.nodes[0]!.workItemId,
  };
}

async function getJson<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`${apiBaseUrl}${path}`);
  expect(response.ok(), await response.text()).toBe(true);
  return await response.json() as T;
}

async function postJson<T>(
  request: APIRequestContext,
  path: string,
  data: unknown,
  expectedStatus = 200,
): Promise<T> {
  const response = await request.post(`${apiBaseUrl}${path}`, { data });
  expect(response.status(), await response.text()).toBe(expectedStatus);
  return await response.json() as T;
}
