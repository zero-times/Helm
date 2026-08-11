import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'packages/database/drizzle/**',
      // Dependencies not yet installed; lint after pnpm install
      'apps/web/**',
      'e2e/**',
      'playwright.config.ts',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
  })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: false },
      ],
    },
  },
  {
    // Drizzle ORM uses complex generic types that typescript-eslint
    // cannot fully resolve at lint time. TypeScript compilation validates
    // correctness, so we relax these rules for the data-access layer.
    files: ['apps/server/src/routes/**/*.ts', 'packages/database/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['**/*.config.ts', '**/*.test.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      // node:test's top-level test/describe registration may be typed as a
      // promise even though registration is intentionally not awaited.
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
  {
    // These classes are deliberately synchronous in-memory implementations
    // of asynchronous persistence contracts used by production adapters.
    files: [
      'packages/audit-events/src/store.ts',
      'packages/bug-qa/src/repository.ts',
      'packages/execution/src/repository.ts',
      'packages/review/src/repository.ts',
    ],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },
);
