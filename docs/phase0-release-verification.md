# Phase 0 Release Verification

## Release decision

Phase 0 is ready for human review when every command below passes against a disposable PostgreSQL database. The release remains gated by explicit Human authorization in the Release Center.

## Reproducible verification

```bash
pnpm install --frozen-lockfile
pnpm infra:up
pnpm db:migrate:twice
pnpm check
pnpm test:e2e
```

Use `pnpm infra:reset` only for a disposable local E2E database. It removes the Compose volume owned by the current checkout.

## Verified result — 2026-08-11

- PostgreSQL 17 migrations completed twice against a disposable database.
- `pnpm check` passed: lint, typecheck, **32 unit tests**, **25 integration tests** (including cancellation-propagation coverage), package tests, and production builds.
- The focused Web client suite passed **14 tests**, including rework review-state regression coverage.
- Chromium Playwright passed **3/3 tests**, including the full release lifecycle and cancellation propagation.
- `git diff --check` passed.

## Acceptance matrix

| Requirement | Automated evidence |
| --- | --- |
| 1 Human + 0 Agent complete loop | `e2e/phase0-release.spec.ts` drives execution, Result, Human review, rework, QA, and release authorization through the production API and UI. |
| Reject and rework history | The first Result is rejected, a second Execution is created, and both attempts plus the rework edge are asserted. |
| Blocking Bug release gate | A critical blocking Bug disables release authorization until its reviewed fix passes QA regression. |
| Idempotency | Replaying a comment command with the same key returns the original response and creates one audit event. |
| Optimistic concurrency | A stale `If-Match` write returns `409 OPTIMISTIC_CONCURRENCY_CONFLICT`. |
| Cancellation propagation | Canceling an upstream node cancels all reachable unfinished nodes connected by hard dependencies, skips already-canceled descendants, leaves soft-edge branches untouched, and derives the Requirement as canceled. Covered by `apps/server/test/work-graph.integration.test.ts` and the E2E. |
| Reproducible report | This document records the commands, covered paths, release gate, rollback, and known risks. |

## Release checklist

- [ ] `pnpm db:migrate:twice` succeeds on the target database.
- [ ] `pnpm check` succeeds without ignored failures.
- [ ] Chromium Playwright release acceptance succeeds.
- [ ] No open blocking Bug is reported by `/api/requirements/:id/release-gate`.
- [ ] The Human approver reviews scope, evidence, known risks, and rollback plan.
- [ ] The Human approver records explicit authorization in the Release Center.

## Rollback

Roll back applications to the previous verified commit. Preserve the PostgreSQL database and immutable audit, Result, Review, and Timeline records. If a migration must be reversed, prepare and review a forward corrective migration instead of editing an applied migration.

## Workspace binding

The Web workspace binds to the first organization in the database. Execution, Review, Bug, and QA records are append-only by database trigger, so integration-test organizations can never be deleted. The E2E therefore seeds its fixture into the existing first organization (creating one only on a pristine database) and scopes its assertions to the fixture's release card, work item, and audit stream. Re-running the E2E against the same database remains valid.

## Known risks and manual checks

- Playwright currently covers Chromium desktop; Safari/WebKit and mobile layouts remain manual compatibility checks.
- Authentication, authorization, secret brokering, and multi-tenant isolation are outside Phase 0 scope.
- SSE reconnection is exercised by component behavior but not by a prolonged network-partition E2E scenario.
- Load, backup restoration, disaster recovery timing, and production observability require environment-specific verification before a public deployment.
