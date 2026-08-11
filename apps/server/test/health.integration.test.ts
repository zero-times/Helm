import { healthResponseSchema } from '@helm/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app';

const openServers: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

function createTestApp(checkDatabase: () => Promise<void>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mockDb: any = { select: () => ({ from: () => ({ where: () => [] }) }) };
  const server = buildApp({
    config: {
      APP_VERSION: 'test',
      WEB_ORIGIN: 'http://localhost:5173',
    },
    checkDatabase,
    database: mockDb,
    logger: false,
  });
  openServers.push(server);
  return server;
}

describe("health routes", () => {
  it("reports liveness without depending on PostgreSQL", async () => {
    const server = createTestApp(() =>
      Promise.reject(new Error("must not be called")),
    );

    const response = await server.inject({
      method: "GET",
      url: "/health/live",
    });

    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json()).status).toBe("ok");
  });

  it("reports readiness only after PostgreSQL responds", async () => {
    const server = createTestApp(() => Promise.resolve());

    const response = await server.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json()).checks?.database).toBe(
      "ok",
    );
  });

  it("returns 503 when PostgreSQL is unavailable", async () => {
    const server = createTestApp(() =>
      Promise.reject(new Error("database unavailable")),
    );

    const response = await server.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(response.statusCode).toBe(503);
    expect(healthResponseSchema.parse(response.json()).status).toBe("error");
  });
});
