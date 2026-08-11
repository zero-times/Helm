# PostgreSQL integration contract

The migration supplies the durable constraints; the application repository must
keep the business mutation and all reliability records in one database
transaction.

## Command transaction

1. Begin a transaction.
2. Reserve `(organization_id, idempotency_key)` by inserting a `processing`
   `idempotency_keys` row with the command type and SHA-256 request fingerprint.
   Use `ON CONFLICT DO NOTHING`.
3. If the insert did not reserve the key, lock and read the existing row. Replay a
   matching completed result. Reject a different command type or fingerprint.
4. Mutate the business row with an optimistic predicate such as
   `WHERE entity_version = $expected_version`. When no row is returned, read the
   current version and raise `OPTIMISTIC_CONCURRENCY_CONFLICT`.
5. Upsert `entity_versions` with the same next version.
6. Insert `domain_events`, its `timeline_events` projection, and its
   `outbox_messages` record. All three share the domain event ID and command
   idempotency key.
7. Store the serialized command result and mark the idempotency row `completed`.
8. Commit. Any error rolls back the business state and every reliability record.

The idempotency reservation belongs inside the transaction. A competing request
with the same key waits on the unique key and can only observe the first request's
committed result; it never executes the business mutation a second time.

## Optimistic update shape

```sql
UPDATE work_items
SET state = $next_state,
    entity_version = entity_version + 1,
    updated_at = now()
WHERE organization_id = $organization_id
  AND id = $work_item_id
  AND entity_version = $expected_version
RETURNING entity_version;
```

Zero returned rows is a domain-visible concurrency conflict, not a generic 500.

## Outbox publisher

Publishers should claim a small pending batch with `FOR UPDATE SKIP LOCKED`,
publish while those row locks are held, mark `published_at`, and commit. A crash
between broker acceptance and the database update can redeliver the message, so
consumers must deduplicate on `domain_event_id`; delivery is at least once. Add an
explicit claim lease before moving broker I/O outside the database transaction.

## Event and timeline pagination

Use `global_position > $cursor ORDER BY global_position LIMIT $limit`. Positions
are stable, monotonic cursors and avoid timestamp ties. Always scope queries by
`organization_id`, then optionally by entity, WorkItem, Execution, category, or
event type.
