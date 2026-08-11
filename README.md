# Helm

Helm is a TypeScript modular monolith for a human-governed workflow system. This
repository currently contains the Phase 0 engineering foundation only: a web
shell, an HTTP server, shared contracts and configuration, PostgreSQL access,
repeatable Drizzle migrations, structured logs, and test baselines.

Business pages, domain workflows, and Agent Runner behavior are intentionally
outside this foundation.

## Prerequisites

- Node.js 24 or newer
- pnpm 10
- Docker with Docker Compose

## Start locally

Install dependencies once:

```bash
pnpm install
```

Then start PostgreSQL, apply all pending migrations, and run the API and web app
with one command:

```bash
pnpm dev
```

The default local endpoints are:

- Web: <http://localhost:5173>
- API liveness: <http://localhost:3000/health/live>
- API readiness (includes PostgreSQL): <http://localhost:3000/health/ready>

Local defaults work without an `.env` file. Copy `.env.example` to `.env` only
when you need to override them.

## Workspace layout

```text
apps/
  server/       Fastify HTTP application and structured Pino logging
  web/          React/Vite application shell
packages/
  config/       Validated server environment contract
  contracts/    Runtime-safe shared API contracts
  database/     Drizzle schema, PostgreSQL client, and migrations
e2e/            Playwright browser tests
```

Packages are private and export TypeScript source inside this monorepo. The web
build bundles its dependencies with Vite; the server build bundles internal
`@helm/*` packages into a deployable ESM artifact.

## Database workflow

The TypeScript schema in `packages/database/src/schema` is the source of truth.
Generate and validate versioned SQL migrations with:

```bash
pnpm db:generate
pnpm db:check
```

Apply pending migrations with:

```bash
pnpm db:migrate
```

Drizzle records applied migrations in PostgreSQL, so running the command again
is safe. `pnpm db:migrate:twice` is used in CI to protect this guarantee.

## Quality commands

```bash
pnpm lint              # ESLint across all workspaces
pnpm typecheck         # strict TypeScript checks
pnpm test:unit         # shared package unit tests
pnpm test:integration  # in-process HTTP integration tests
pnpm test:e2e          # Playwright web/API smoke path
pnpm build             # production web and server builds
pnpm check             # lint + types + unit/integration + build
```

The CI job adds a real PostgreSQL service, validates the migration journal,
applies migrations twice, runs the full static/test/build checks, and then runs
the Chromium E2E path.

## Runtime behavior

- `/health/live` reports whether the server process can serve requests.
- `/health/ready` queries PostgreSQL and returns HTTP 503 if it is unavailable.
- Production logs are newline-delimited JSON. Development logs are formatted
  for local reading, with authorization, cookie, password, token, and secret
  fields redacted.
- Shutdown signals stop HTTP intake and close the PostgreSQL pool cleanly.

Stop local infrastructure with `pnpm infra:down`. To deliberately delete the
local PostgreSQL volume, run `pnpm infra:reset`.
