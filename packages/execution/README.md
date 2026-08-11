# `@helm/execution`

Phase 0 domain package for Human Self and External/Manual execution attempts.

## Guarantees

- A manual execution starts in `running` and binds the WorkItem and
  `graphVersion` that were current at start time.
- Only explicit, version-checked transitions are accepted.
- `completed`, `failed`, and `cancelled` are terminal and all create a structured
  Result in the same repository operation.
- A Result is insert-only, is bound to exactly one Execution, and contains
  structured changes, tests, Artifacts, known issues, verification provenance,
  and any required human decision.
- Returned domain facts and nested collections are runtime-frozen.
- The PostgreSQL contract rejects updates or deletes of Results and their child
  facts, and rejects changes to terminal Executions.

## Work Graph integration

`ManualExecutionService` accepts a `ManualExecutionStartGuard`. The Server
composition injects a PostgreSQL-backed guard that verifies the WorkItem is
`ready`, the requested `graphVersion` is current, and the executor belongs to
the WorkItem organization. A database trigger repeats the readiness/version
check under a row lock so callers cannot bypass it or race a state transition.

## Runtime API

- `POST /api/work-items/:id/executions` starts a Self or External/Manual attempt.
- `POST /api/executions/:id/wait-for-input` and `/resume` update active attempts.
- `POST /api/executions/:id/finish` atomically writes a terminal Execution and
  its structured Result.
- `GET /api/executions/:id`, `/api/executions/:id/result`, and
  `GET /api/work-items/:id/executions` expose individual facts and full history.

## Verification

Node 22.18+ can execute the TypeScript tests without a transpilation step:

```sh
node --test test/*.test.ts
pnpm typecheck
```

The executable PostgreSQL schema, foreign keys, lifecycle triggers, immutable
fact triggers, and deferred Result-count checks live in database migration
`0003_curly_kree.sql`. `sql/001_execution_result.sql` remains the standalone
domain contract reference.
