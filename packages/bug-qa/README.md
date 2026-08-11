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

`PostgresBugRepository` persists every compound state change atomically with
optimistic versions. `PostgresPassedReviewGateReader` resolves the referenced
Execution → Result → Review → passed Human Gate chain before a fix can enter
QA. The Server exposes Bug creation/query, fix submission, regression
completion, and Requirement release-gate endpoints under `/api`.

The production schema is part of the unified Drizzle chain in migration
`0005_messy_sister_grimm.sql`. It adds foreign keys, immutable edge triggers,
deferred Bug/QA consistency checks, and Requirement status synchronization.
The standalone `sql/003_bug_qa.sql` remains a domain-level reference only.
