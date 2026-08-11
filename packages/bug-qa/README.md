# `@helm/bug-qa`

HELM-2's domain package makes a defect a queryable `BugWorkItem` rather than a
free-form issue attached to a Result.

## Workflow

1. A QA member creates a Bug with its source Requirement, graph version,
   discovery stage, severity, and release-blocking flag.
2. A blocking Bug is returned by `BugBlockingPolicy`, which guards both
   Requirement completion and release.
3. Engineering starts a fix. `submitFixForQa` accepts the fix only after the
   injected HELM-5 `HumanGatePolicy` adapter confirms its Review gate passed.
4. The repository atomically records an immutable fix edge and a pending QA
   regression edge, moving the Bug to `awaiting_qa` without manual routing.
5. A passed regression closes the Bug and clears `blocking`. A failed
   regression records the failed edge and returns the Bug to `open`, preserving
   the release block and allowing another immutable fix attempt.

Production adapters must implement every mutating repository method as one
transaction and use optimistic versions. Apply `sql/003_bug_qa.sql` after the
Execution/Result and Review/Gate migrations.
