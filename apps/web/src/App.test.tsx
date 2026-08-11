import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
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
});
