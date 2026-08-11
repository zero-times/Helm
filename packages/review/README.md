# `@helm/review`

Phase 0 domain package for Result review, Human gates, and explicit Rework.

## Workflow guarantees

1. A Review can only be requested for the immutable Result of a completed
   Execution.
2. A pending Review owns one pending Human gate. Approval atomically records an
   approved Review and a passed gate. Rejection atomically records a rejected
   Review, a `rework_required` gate, and one explicit Rework request.
3. Review and gate decisions are terminal facts. Every update is
   version-checked, and the PostgreSQL contract prevents decision mutation or
   deletion.
4. Starting Rework creates a new running Execution for the same WorkItem and
   graph version, then links it to the rejected Review. The previous Execution
   and Result remain unchanged and queryable.
5. `HumanGatePolicy` is the Work Graph integration boundary. A reviewed
   WorkItem cannot complete unless its gate passed, and a downstream node
   remains unready while any required gate is missing, pending, or rejected.

## Composition

`ReviewWorkflowService` reads completed attempts through the HELM-3
`ExecutionRepository`. `InMemoryReviewRepository` remains deterministic test
infrastructure, while `PostgresReviewRepository` persists Review, Gate, Rework,
and the new Rework Execution in version-checked transactions. Migration
`0004_lame_cerise.sql` supplies foreign keys, lifecycle checks, immutable fact
guards, and deferred Review/Gate/Rework consistency constraints;
`sql/002_review_gate.sql` remains the standalone domain contract reference.

The Server Work Graph composition calls
`HumanGatePolicy.assertReviewedWorkItemCanComplete` before reviewed-node
completion and `HumanGatePolicy.assertDownstreamCanBecomeReady` before manual
readiness transitions. PostgreSQL repeats both checks for direct writes. The
Rework start path requires an `in_progress` WorkItem with a matching requested
Rework, current graph version, and executor in the same organization.

## Runtime API

- `POST /api/executions/:id/reviews` requests Review and opens its Human Gate.
- `POST /api/reviews/:id/approve` passes the Gate; `/reject` creates Rework.
- `POST /api/rework-requests/:id/start` atomically starts a new Execution.
- `GET /api/reviews/:id` and `GET /api/work-items/:id/reviews` expose current
  decisions and immutable history.

## Verification

```sh
node --test test/*.test.ts
tsc --project tsconfig.json
```
