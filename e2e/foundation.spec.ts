import { expect, test } from "@playwright/test";

test("management cockpit and server health contract are available", async ({
  page,
  request,
}) => {
  const healthResponse = await request.get("http://127.0.0.1:3100/health/live");
  expect(healthResponse.ok()).toBe(true);
  await expect(healthResponse.json()).resolves.toMatchObject({
    service: "helm-server",
    status: "ok",
    version: "0.1.0",
  });

  await page.goto("/");

  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { name: "待你处理" })).toBeVisible();
});
