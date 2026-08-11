import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { MockHelmClient } from "./api/mock-client";
import { HelmProvider } from "./state/helm-context";

function renderApp(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HelmProvider client={new MockHelmClient()}>
        <App />
      </HelmProvider>
    </MemoryRouter>,
  );
}

describe("Helm management dashboard", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("centers the cockpit on human attention instead of agent presence", async () => {
    renderApp();
    expect(await screen.findByRole("heading", { name: "今天，只需要处理 2 件事。" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "待你处理" })).toBeInTheDocument();
    expect(screen.getByText("v0.1.0-alpha 等待发布授权")).toBeInTheDocument();
    expect(screen.queryByText(/Agent 在线/)).not.toBeInTheDocument();
  });

  it("starts a ready work item and exposes the structured Result form", async () => {
    renderApp("/work-items/wi-build");
    const begin = await screen.findByRole("button", { name: "开始人工执行" });
    fireEvent.click(begin);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "回填结构化 Result" })).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/结果摘要/)).toBeRequired();
    expect(screen.getByLabelText("改动文件")).toBeInTheDocument();
    expect(screen.getByLabelText("测试结果")).toBeInTheDocument();
  });

  it("keeps raw logs as a collapsed secondary detail", async () => {
    renderApp("/work-items/wi-build");
    const rawLog = await screen.findByText("查看原始日志");
    expect(rawLog.closest("details")).not.toHaveAttribute("open");
  });

  it("shows the explicit release authorization gate", async () => {
    renderApp("/releases");
    expect(await screen.findByRole("heading", { name: "授权这个版本发布" })).toBeInTheDocument();
    expect(screen.getByLabelText(/授权说明/)).toBeRequired();
    expect(screen.getByRole("button", { name: "明确授权发布" })).toBeEnabled();
  });

  it("renders a responsibility-perspective selector with all members", async () => {
    renderApp();
    const select = await screen.findByRole("combobox", { name: /责任人视角/ });
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue("all");

    const options = Array.from((select as HTMLSelectElement).options).map((opt) => opt.value);
    expect(options).toContain("all");
    expect(options).toContain("member-wang");
    expect(options).toContain("member-li");
    expect(options).toContain("member-zhang");
  });

  it("filters cockpit view when a specific member is selected", async () => {
    renderApp();
    await screen.findByRole("heading", { name: "今天，只需要处理 2 件事。" });

    const select = screen.getByRole("combobox", { name: /责任人视角/ });
    fireEvent.change(select, { target: { value: "member-zhang" } });

    await screen.findByRole("heading", { name: "今天没有待决事项。" });
    expect(screen.queryByText("v0.1.0-alpha 等待发布授权")).not.toBeInTheDocument();
    expect(screen.queryByText("扫码登录可以开始执行")).not.toBeInTheDocument();
  });

  it("shows all data when '全部责任人' is selected", async () => {
    renderApp();
    const select = await screen.findByRole("combobox", { name: /责任人视角/ });

    // Default is "all"
    expect(select).toHaveValue("all");
    expect(screen.getByText("v0.1.0-alpha 等待发布授权")).toBeInTheDocument();
  });

  it("persists perspective selection in a localStorage-like store", async () => {
    renderApp();
    const select = await screen.findByRole("combobox", { name: /责任人视角/ });

    fireEvent.change(select, { target: { value: "member-zhang" } });
    expect(select).toHaveValue("member-zhang");
    expect(window.localStorage.getItem("helm:perspective:selectedMemberId")).toBe("member-zhang");
  });

  it("falls back to all members when a persisted perspective no longer exists", async () => {
    window.localStorage.setItem("helm:perspective:selectedMemberId", "member-removed");
    renderApp();

    const select = await screen.findByRole("combobox", { name: /责任人视角/ });
    await waitFor(() => expect(select).toHaveValue("all"));
    expect(window.localStorage.getItem("helm:perspective:selectedMemberId")).toBe("all");
  });

  it("falls back to the requirement ledger when the selected perspective has no graph", async () => {
    renderApp();
    await screen.findByRole("heading", { name: "今天，只需要处理 2 件事。" });

    fireEvent.change(screen.getByRole("combobox", { name: /责任人视角/ }), {
      target: { value: "member-zhang" },
    });
    await screen.findByRole("heading", { name: "今天没有待决事项。" });

    const sidebarLinks = document.querySelectorAll(".nav-link, .mobile-nav-link");
    const graphLink = Array.from(sidebarLinks).find(
      (el) => el.textContent?.includes("工作图"),
    ) as HTMLAnchorElement | undefined;
    expect(graphLink).toBeTruthy();
    expect(graphLink!.getAttribute("href")).toBe("/projects#requirements-title");
  });

  it("shows instructive empty-state card with CTAs when no attention items", async () => {
    window.localStorage.setItem("helm:perspective:selectedMemberId", "member-zhang");
    renderApp();
    await screen.findByRole("heading", { name: "今天没有待决事项。" });
    expect(screen.getByText("没有需要你关注的事项")).toBeInTheDocument();
    const newReqLinks = screen.getAllByRole("link", { name: /新建需求/ });
    expect(newReqLinks.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("link", { name: /查看需求账本/ })).toBeInTheDocument();
  });

  it("creates a requirement with work items and navigates to the new graph", async () => {
    renderApp("/requirements/new");
    await screen.findByRole("heading", { name: "新建需求" });

    // Fill project
    const projectSelect = screen.getByLabelText(/所属项目/);
    fireEvent.change(projectSelect, { target: { value: "project-helm" } });

    // Fill goal
    const goalTextarea = screen.getByLabelText(/需求目标/);
    fireEvent.change(goalTextarea, { target: { value: "测试自动化需求" } });

    // Fill acceptance criterion
    const criterionInput = screen.getByLabelText("验收标准 1");
    fireEvent.change(criterionInput, { target: { value: "所有测试通过" } });

    // Assign responsibilities
    const accountableSelect = screen.getByLabelText(/最终责任人/);
    fireEvent.change(accountableSelect, { target: { value: "member-wang" } });
    const ownerSelect = screen.getByLabelText(/日常负责人/);
    fireEvent.change(ownerSelect, { target: { value: "member-li" } });
    const assigneeSelect = screen.getByLabelText(/当前执行人/);
    fireEvent.change(assigneeSelect, { target: { value: "member-wang" } });

    // Fill work item
    const workItemInput = screen.getByLabelText("工作项 1 标题");
    fireEvent.change(workItemInput, { target: { value: "编写测试用例" } });

    // Submit
    const submitButton = screen.getByRole("button", { name: "创建需求并生成工作图" });
    fireEvent.click(submitButton);

    // Should navigate to the new graph (URL changes)
    await waitFor(() => {
      // Verify we navigated away (new requirement created)
      expect(screen.queryByRole("heading", { name: "新建需求" })).not.toBeInTheDocument();
    });
  });

  it("shows validation errors when required fields are missing on the new requirement form", async () => {
    renderApp("/requirements/new");
    await screen.findByRole("heading", { name: "新建需求" });

    // Click submit without filling anything
    const submitButton = screen.getByRole("button", { name: "创建需求并生成工作图" });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText("请选择所属项目。")).toBeInTheDocument();
      expect(screen.getByText("请填写需求目标。")).toBeInTheDocument();
      expect(screen.getByText("请至少填写一条验收标准。")).toBeInTheDocument();
      expect(screen.getByText("请指定最终责任人。")).toBeInTheDocument();
    });
  });

  it("shows easy access to new requirement from cockpit page", async () => {
    renderApp();
    await screen.findByRole("heading", { name: "今天，只需要处理 2 件事。" });

    const ctaLinks = screen.getAllByRole("link", { name: /新建需求/ });
    expect(ctaLinks.length).toBeGreaterThanOrEqual(1);
    expect(ctaLinks[0].getAttribute("href")).toBe("/requirements/new");
  });

  it("renders the new project page with identity and responsibility forms", async () => {
    renderApp("/projects/new");
    expect(await screen.findByRole("heading", { name: "新建项目" })).toBeInTheDocument();
    expect(screen.getByLabelText("项目名称")).toBeInTheDocument();
    expect(screen.getByLabelText("项目标识 slug")).toBeInTheDocument();
    expect(screen.getByLabelText("项目描述")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建项目" })).toBeInTheDocument();
  });

  it("creates a project and navigates to projects page", async () => {
    renderApp("/projects/new");
    await screen.findByRole("heading", { name: "新建项目" });

    fireEvent.change(screen.getByLabelText("项目名称"), { target: { value: "Test Project" } });
    fireEvent.change(screen.getByLabelText("项目标识 slug"), { target: { value: "test-project" } });
    fireEvent.change(screen.getByLabelText("项目描述"), { target: { value: "A test" } });

    // Select responsible members
    const selects = screen.getAllByRole("combobox");
    const accountableSelect = selects.find((s) => s.closest("label")?.textContent?.includes("最终责任人"));
    const ownerSelect = selects.find((s) => s.closest("label")?.textContent?.includes("日常负责人"));
    if (accountableSelect) fireEvent.change(accountableSelect, { target: { value: "member-wang" } });
    if (ownerSelect) fireEvent.change(ownerSelect, { target: { value: "member-li" } });

    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "新建项目" })).not.toBeInTheDocument();
    });
  });

  it("shows validation errors on new project form when fields are empty", async () => {
    renderApp("/projects/new");
    await screen.findByRole("heading", { name: "新建项目" });

    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));

    await waitFor(() => {
      expect(screen.getByText("请填写项目名称。")).toBeInTheDocument();
      expect(screen.getByText("请填写项目标识（slug）。")).toBeInTheDocument();
      expect(screen.getByText("请指定最终责任人。")).toBeInTheDocument();
    });
  });

  it("renders the edit project page with project data and delete section", async () => {
    renderApp("/projects/project-helm/edit");
    expect(await screen.findByRole("heading", { name: "管理项目" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Helm Workflow OS")).toBeInTheDocument();
    expect(screen.getByDisplayValue("helm")).toBeInTheDocument();

    // Delete section should be visible
    expect(screen.getByRole("heading", { name: "删除项目" })).toBeInTheDocument();
  });

  it("shows inline delete confirmation on edit project page", async () => {
    // Use project-site which has a requirement (req-site-7)
    renderApp("/projects/project-site/edit");
    await screen.findByRole("heading", { name: "管理项目" });

    // The delete button should appear but be disabled since project-site has a requirement
    const deleteButton = screen.getByRole("button", { name: "删除项目" });
    expect(deleteButton).toBeDisabled();

    // Verify the explanation about requirements blocking deletion
    expect(screen.getByText(/无法删除/)).toBeInTheDocument();
  });

  it("renders the edit requirement page with form fields pre-filled", async () => {
    renderApp("/requirements/req-42/edit");
    expect(await screen.findByRole("heading", { name: "编辑需求" })).toBeInTheDocument();

    // Goal textarea should be pre-filled
    const goalTextarea = screen.getByLabelText("需求目标");
    expect(goalTextarea).toHaveValue("让桌面端用户通过手机扫码，在 30 秒内完成安全登录。");

    // Acceptance criteria should be pre-filled
    expect(screen.getByDisplayValue("30 秒内完成安全登录")).toBeInTheDocument();
    expect(screen.getByDisplayValue("支持过期与拒绝路径")).toBeInTheDocument();

    // Delete section
    expect(screen.getByRole("heading", { name: "删除需求" })).toBeInTheDocument();
  });

  it("shows graph-blocked deletion note on edit requirement page", async () => {
    // req-42 has a graph, so deletion should show a warning
    renderApp("/requirements/req-42/edit");
    await screen.findByRole("heading", { name: "编辑需求" });

    expect(screen.getByText(/审计链不完整/)).toBeInTheDocument();
  });

  it("shows 管理项目 action on project cards in projects page", async () => {
    renderApp("/projects");
    await screen.findByRole("heading", { name: "从目标，看见真实进度。" });

    const manageLinks = screen.getAllByText("管理项目");
    expect(manageLinks.length).toBe(2); // Two projects
    expect(manageLinks[0].closest("a")).toHaveAttribute("href", "/projects/project-helm/edit");
  });

  it("shows 编辑 and 工作图 row actions in requirement table", async () => {
    renderApp("/projects");
    await screen.findByRole("heading", { name: "从目标，看见真实进度。" });

    const editButtons = screen.getAllByText("编辑");
    expect(editButtons.length).toBeGreaterThanOrEqual(1);

    const graphButtons = screen.getAllByText("工作图");
    expect(graphButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("shows 新建项目 CTA on projects page", async () => {
    renderApp("/projects");
    await screen.findByRole("heading", { name: "从目标，看见真实进度。" });

    const newProjectLinks = screen.getAllByText("新建项目");
    expect(newProjectLinks.length).toBeGreaterThanOrEqual(1);
  });
});
