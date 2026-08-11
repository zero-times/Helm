# Helm Phase 0 Web

The management dashboard is deliberately organized around human attention, not Agent presence. It covers the Phase 0 project/requirement ledger, Work Graph, structured WorkItem Timeline, manual Execution and Result submission, Review/Rework, Release Gate authorization, and live updates.

## Data modes

Mock mode is the default so the complete UI flow remains reviewable before the Phase 0 API branches are integrated:

```bash
pnpm dev
```

Use the real API adapter with:

```bash
VITE_DATA_MODE=api VITE_API_BASE_URL=http://localhost:3000 pnpm dev
```

The HTTP adapter centralizes the integration boundary:

| Action | Endpoint |
| --- | --- |
| Dashboard snapshot | `GET /api/v1/dashboard` |
| Start manual execution | `POST /api/v1/work-items/:id/executions` |
| Submit Result | `POST /api/v1/work-items/:id/results` |
| Approve / reject Result | `POST /api/v1/work-items/:id/reviews` |
| Add Timeline comment | `POST /api/v1/work-items/:id/comments` |
| Authorize release | `POST /api/v1/releases/:id/gate` |
| Live events | `GET /api/v1/events` (SSE) |

Mutation requests include `Idempotency-Key`; versioned WorkItem commands also include `If-Match`.

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
```

