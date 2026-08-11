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
`ExecutionRepository`. `InMemoryReviewRepository` is deterministic test
infrastructure and coordinates creation of a new Execution with the Rework
link. A production adapter must implement each repository mutation in one
database transaction; `sql/002_review_gate.sql` supplies the storage-level
constraints and immutability guards.

HELM-10 should call `HumanGatePolicy.assertReviewedWorkItemCanComplete` before
the reviewed-node completion transition and
`HumanGatePolicy.assertDownstreamCanBecomeReady` before deriving downstream
readiness. Construction also requires a Rework start guard that checks the
current WorkItem state and graph version, preventing production composition
from silently falling back to a permissive policy.

## Verification

```sh
node --test test/*.test.ts
tsc --project tsconfig.json
```
