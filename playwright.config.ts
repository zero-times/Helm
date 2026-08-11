import { defineConfig, devices } from '@playwright/test';

const serverEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '3100',
  LOG_LEVEL: 'silent',
  DATABASE_URL:
    process.env.DATABASE_URL ?? 'postgres://helm:helm@127.0.0.1:5432/helm',
  WEB_ORIGIN: 'http://127.0.0.1:4173',
};

const webEnvironment = {
  ...process.env,
  VITE_DATA_MODE: 'api',
  VITE_API_BASE_URL: 'http://127.0.0.1:3100',
};

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      name: 'api',
      command:
        'pnpm --filter @helm/server build && pnpm --filter @helm/server start',
      env: serverEnvironment,
      url: 'http://127.0.0.1:3100/health/live',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 1_000 },
    },
    {
      name: 'web',
      command:
        'pnpm --filter @helm/web exec vite --host 127.0.0.1 --port 4173',
      env: webEnvironment,
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 1_000 },
    },
  ],
});
