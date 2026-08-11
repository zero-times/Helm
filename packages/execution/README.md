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

`ManualExecutionService` accepts a `ManualExecutionStartGuard`. The HELM-10
composition must inject a guard that verifies the WorkItem is `ready` and that
the requested `graphVersion` is current. Keeping that rule behind a port lets
this package remain independently testable while preserving the dependency.

## Verification

Node 22.18+ can execute the TypeScript tests without a transpilation step:

```sh
node --test test/*.test.ts
pnpm typecheck
```

`sql/001_execution_result.sql` is the PostgreSQL persistence contract. The
foundation integration should run it through the repository's migration runner
and add foreign keys from `work_item_id` and `executor_member_id` after the
HELM-10 and HELM-4 table names are finalized.
