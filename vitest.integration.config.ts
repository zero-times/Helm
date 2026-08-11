import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'integration',
    environment: 'node',
    include: [
      'apps/**/*.integration.test.ts',
      'packages/**/*.integration.test.ts',
    ],
    passWithNoTests: false,
  },
});
