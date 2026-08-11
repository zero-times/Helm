# HELM-4 Core Domain

Phase 0 implementation of the HELM organization domain model.

## Project Structure

```
helm/
├── apps/
│   └── server/          # Fastify HTTP API server
├── packages/
│   ├── config/          # Environment configuration (zod-validated)
│   ├── contracts/       # Shared API contracts (health, etc.)
│   ├── core-domain/     # Pure domain logic, entities, errors, validation
│   └── database/        # Drizzle ORM schema, migrations, client
├── docker-compose.yml   # PostgreSQL 17 for local development
└── vitest.*.config.ts   # Unit and integration test configs
```

## Quick Start

```bash
# Install dependencies
pnpm install

# Start PostgreSQL
pnpm infra:up

# Run migrations
pnpm db:migrate

# Start dev server
pnpm dev:apps

# Run checks
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
```

## Database

PostgreSQL 17 with Drizzle ORM. Connection defaults to:
`postgres://helm:helm@localhost:5432/helm`

Override via `DATABASE_URL` environment variable.

### Migrations

```bash
# Check schema matches migrations
pnpm db:check

# Generate new migration from schema changes
pnpm db:generate

# Apply migrations
pnpm db:migrate

# Verify idempotency
pnpm db:migrate:twice
```

## Domain Model

### Member Types
- **Human** — a person who can be held accountable
- **Agent** — an AI agent (cannot be accountable human)
- **Service** — an automated service/CI pipeline

### Invariants
- `accountableHumanId` on a Project or Requirement must reference a **Human** member in the same organization
- `operationalOwnerId` and `assigneeMemberId` must belong to the same organization as the referenced entity
- Requirement `goal` must be non-blank and `acceptanceCriteria` must be a non-empty JSON array of non-blank strings
- Role assignments are unique per member-organization-role combination (a member can hold multiple different roles)
- Project slugs are unique per organization
- Database-level triggers enforce cross-table accountability and cross-organization checks

## API Endpoints

### Organizations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/organizations` | Create organization |
| GET | `/api/organizations` | List all organizations |
| GET | `/api/organizations/:id` | Get organization by ID |

### Members

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/members` | Create member (human/agent/service) |
| GET | `/api/members` | List members (?organizationId=...) |
| GET | `/api/members/:id` | Get member by ID |

### Role Assignments

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/role-assignments` | Create role assignment |
| GET | `/api/role-assignments` | List assignments (?organizationId=&memberId=) |
| GET | `/api/role-assignments/:id` | Get assignment by ID |

### Projects

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/projects` | Create project (enforces accountableHuman is Human) |
| GET | `/api/projects` | List projects (?organizationId=...) |
| GET | `/api/projects/:id` | Get project with responsibility view |

### Requirements

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/requirements` | Create requirement |
| GET | `/api/requirements` | List requirements (?projectId=...) |
| GET | `/api/requirements/:id` | Get requirement with assignee details |
| GET | `/api/requirements/by-assignee/:memberId` | Responsibility view by assignee |

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health/live` | Liveness check |
| GET | `/health/ready` | Readiness check (includes database) |

## Testing

```bash
# Unit tests (pure domain logic)
pnpm test:unit

# Integration tests (requires PostgreSQL)
DATABASE_URL=postgres://helm:helm@localhost:5432/helm pnpm test:integration
```

Integration tests require a running PostgreSQL instance. Start it with `pnpm infra:up`.

## Error Handling

All domain errors extend `DomainError` with machine-readable codes:

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `NOT_FOUND` | 404 | Entity not found |
| `VALIDATION_ERROR` | 400 | Invalid input |
| `CONFLICT` | 409 | Duplicate or conflicting state |
| `CROSS_ORGANIZATION` | 422 | Reference to wrong organization |
| `ACCOUNTABLE_HUMAN_REQUIRED` | 422 | Accountable must be Human |
| `NON_EMPTY_FIELD_REQUIRED` | 400 | Required field is empty |

## Environment Variables

See `.env.example` for all supported variables.
