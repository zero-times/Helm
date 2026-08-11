BEGIN;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  organization_id text NOT NULL,
  idempotency_key text NOT NULL,
  command_type text NOT NULL,
  request_fingerprint char(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'completed')),
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (organization_id, idempotency_key),
  CHECK (length(btrim(idempotency_key)) > 0),
  CHECK (
    (status = 'processing' AND completed_at IS NULL)
    OR (status = 'completed' AND completed_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS entity_versions (
  organization_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  entity_version bigint NOT NULL CHECK (entity_version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS domain_events (
  global_position bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  event_id uuid PRIMARY KEY,
  event_type text NOT NULL CHECK (length(btrim(event_type)) > 0),
  organization_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  work_item_id text,
  execution_id text,
  actor_member_id text NOT NULL,
  source text NOT NULL,
  graph_version bigint CHECK (graph_version > 0),
  entity_version bigint NOT NULL CHECK (entity_version > 0),
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_decision_id text,
  FOREIGN KEY (organization_id, idempotency_key)
    REFERENCES idempotency_keys (organization_id, idempotency_key)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX IF NOT EXISTS domain_events_entity_position_idx
  ON domain_events (organization_id, entity_type, entity_id, global_position);
CREATE INDEX IF NOT EXISTS domain_events_work_item_position_idx
  ON domain_events (organization_id, work_item_id, global_position)
  WHERE work_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS domain_events_execution_position_idx
  ON domain_events (organization_id, execution_id, global_position)
  WHERE execution_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS domain_events_type_position_idx
  ON domain_events (organization_id, event_type, global_position);

CREATE TABLE IF NOT EXISTS timeline_events (
  global_position bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  timeline_event_id uuid PRIMARY KEY,
  domain_event_id uuid NOT NULL UNIQUE REFERENCES domain_events (event_id),
  organization_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  work_item_id text,
  execution_id text,
  category text NOT NULL,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  importance text NOT NULL DEFAULT 'normal'
    CHECK (importance IN ('normal', 'important', 'critical')),
  actor_member_id text NOT NULL,
  source text NOT NULL,
  entity_version bigint NOT NULL CHECK (entity_version > 0),
  occurred_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS timeline_events_entity_position_idx
  ON timeline_events (organization_id, entity_type, entity_id, global_position);
CREATE INDEX IF NOT EXISTS timeline_events_work_item_position_idx
  ON timeline_events (organization_id, work_item_id, global_position)
  WHERE work_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS timeline_events_execution_position_idx
  ON timeline_events (organization_id, execution_id, global_position)
  WHERE execution_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS outbox_messages (
  message_id uuid PRIMARY KEY,
  domain_event_id uuid NOT NULL UNIQUE REFERENCES domain_events (event_id),
  topic text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text
);

CREATE INDEX IF NOT EXISTS outbox_messages_pending_idx
  ON outbox_messages (created_at, message_id)
  WHERE published_at IS NULL;

CREATE OR REPLACE FUNCTION helm_reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS domain_events_append_only ON domain_events;
CREATE TRIGGER domain_events_append_only
  BEFORE UPDATE OR DELETE ON domain_events
  FOR EACH ROW EXECUTE FUNCTION helm_reject_append_only_mutation();

DROP TRIGGER IF EXISTS timeline_events_append_only ON timeline_events;
CREATE TRIGGER timeline_events_append_only
  BEFORE UPDATE OR DELETE ON timeline_events
  FOR EACH ROW EXECUTE FUNCTION helm_reject_append_only_mutation();

COMMIT;
