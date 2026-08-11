CREATE TYPE helm_manual_execution_mode AS ENUM ('self', 'external_manual');
CREATE TYPE helm_manual_execution_status AS ENUM (
  'running',
  'waiting_for_input',
  'completed',
  'failed',
  'cancelled'
);
CREATE TYPE helm_verification_source AS ENUM (
  'unverified',
  'agent_reported',
  'runner_verified',
  'ci_verified',
  'human_verified'
);
CREATE TYPE helm_artifact_kind AS ENUM (
  'file',
  'url',
  'commit',
  'patch',
  'log',
  'report',
  'other'
);
CREATE TYPE helm_test_status AS ENUM ('passed', 'failed', 'skipped', 'not_run');
CREATE TYPE helm_issue_severity AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TABLE manual_executions (
  id uuid PRIMARY KEY,
  work_item_id uuid NOT NULL,
  graph_version integer NOT NULL CHECK (graph_version > 0),
  mode helm_manual_execution_mode NOT NULL,
  executor_member_id uuid NOT NULL,
  status helm_manual_execution_status NOT NULL DEFAULT 'running',
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  ended_at timestamptz,
  waiting_reason text,
  end_reason text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT manual_executions_lifecycle_check CHECK (
    (status = 'running' AND ended_at IS NULL AND waiting_reason IS NULL)
    OR (status = 'waiting_for_input' AND ended_at IS NULL AND waiting_reason IS NOT NULL)
    OR (status = 'completed' AND ended_at IS NOT NULL AND waiting_reason IS NULL)
    OR (
      status IN ('failed', 'cancelled')
      AND ended_at IS NOT NULL
      AND waiting_reason IS NULL
      AND end_reason IS NOT NULL
    )
  ),
  CONSTRAINT manual_executions_time_check CHECK (
    updated_at >= started_at AND (ended_at IS NULL OR ended_at >= started_at)
  )
);

CREATE INDEX manual_executions_work_item_started_idx
  ON manual_executions (work_item_id, started_at, id);

CREATE TABLE execution_results (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL UNIQUE REFERENCES manual_executions(id) ON DELETE RESTRICT,
  work_item_id uuid NOT NULL,
  outcome helm_manual_execution_status NOT NULL CHECK (
    outcome IN ('completed', 'failed', 'cancelled')
  ),
  summary text NOT NULL CHECK (length(btrim(summary)) > 0),
  changed_files jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(changed_files) = 'array'
  ),
  change_set jsonb,
  commit_reference text,
  needs_human_decision boolean NOT NULL DEFAULT false,
  human_decision jsonb,
  session_reference jsonb,
  actual_cost jsonb,
  duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  verification_source helm_verification_source NOT NULL,
  created_at timestamptz NOT NULL,
  artifact_count integer NOT NULL CHECK (artifact_count >= 0),
  test_count integer NOT NULL CHECK (test_count >= 0),
  test_artifact_link_count integer NOT NULL CHECK (test_artifact_link_count >= 0),
  known_issue_count integer NOT NULL CHECK (known_issue_count >= 0),
  CONSTRAINT execution_results_decision_check CHECK (
    needs_human_decision = (human_decision IS NOT NULL)
  )
);

CREATE INDEX execution_results_work_item_created_idx
  ON execution_results (work_item_id, created_at, id);

CREATE TABLE result_artifacts (
  id uuid PRIMARY KEY,
  result_id uuid NOT NULL REFERENCES execution_results(id) ON DELETE RESTRICT,
  kind helm_artifact_kind NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  uri text NOT NULL CHECK (length(btrim(uri)) > 0),
  media_type text,
  digest_algorithm text CHECK (digest_algorithm IS NULL OR digest_algorithm = 'sha256'),
  digest_value text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (result_id, id),
  CONSTRAINT result_artifacts_digest_check CHECK (
    (digest_algorithm IS NULL) = (digest_value IS NULL)
  )
);

CREATE TABLE execution_test_results (
  id uuid PRIMARY KEY,
  result_id uuid NOT NULL REFERENCES execution_results(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  status helm_test_status NOT NULL,
  command text,
  details text,
  UNIQUE (result_id, id)
);

CREATE TABLE test_result_artifacts (
  result_id uuid NOT NULL,
  test_result_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  PRIMARY KEY (test_result_id, artifact_id),
  FOREIGN KEY (result_id, test_result_id)
    REFERENCES execution_test_results(result_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (result_id, artifact_id)
    REFERENCES result_artifacts(result_id, id) ON DELETE RESTRICT
);

CREATE TABLE result_known_issues (
  id uuid PRIMARY KEY,
  result_id uuid NOT NULL REFERENCES execution_results(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  severity helm_issue_severity NOT NULL,
  blocking boolean NOT NULL,
  UNIQUE (result_id, id)
);

CREATE FUNCTION helm_guard_manual_execution_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'terminal execution % is immutable', OLD.id;
  END IF;
  IF NEW.id <> OLD.id
    OR NEW.work_item_id <> OLD.work_item_id
    OR NEW.graph_version <> OLD.graph_version
    OR NEW.mode <> OLD.mode
    OR NEW.executor_member_id <> OLD.executor_member_id
    OR NEW.started_at <> OLD.started_at
  THEN
    RAISE EXCEPTION 'execution identity fields are immutable';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'execution version must increment exactly once';
  END IF;
  IF NOT (
    (OLD.status = 'running' AND NEW.status IN (
      'waiting_for_input', 'completed', 'failed', 'cancelled'
    ))
    OR (OLD.status = 'waiting_for_input' AND NEW.status IN (
      'running', 'completed', 'failed', 'cancelled'
    ))
  ) THEN
    RAISE EXCEPTION 'invalid manual execution transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_manual_execution_update
BEFORE UPDATE ON manual_executions
FOR EACH ROW EXECUTE FUNCTION helm_guard_manual_execution_update();

CREATE FUNCTION helm_prevent_fact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'historical execution result facts are immutable';
END;
$$;

CREATE TRIGGER prevent_manual_execution_delete
BEFORE DELETE ON manual_executions
FOR EACH ROW EXECUTE FUNCTION helm_prevent_fact_mutation();

CREATE TRIGGER prevent_execution_result_mutation
BEFORE UPDATE OR DELETE ON execution_results
FOR EACH ROW EXECUTE FUNCTION helm_prevent_fact_mutation();

CREATE TRIGGER prevent_result_artifact_mutation
BEFORE UPDATE OR DELETE ON result_artifacts
FOR EACH ROW EXECUTE FUNCTION helm_prevent_fact_mutation();

CREATE TRIGGER prevent_execution_test_result_mutation
BEFORE UPDATE OR DELETE ON execution_test_results
FOR EACH ROW EXECUTE FUNCTION helm_prevent_fact_mutation();

CREATE TRIGGER prevent_test_result_artifact_mutation
BEFORE UPDATE OR DELETE ON test_result_artifacts
FOR EACH ROW EXECUTE FUNCTION helm_prevent_fact_mutation();

CREATE TRIGGER prevent_result_known_issue_mutation
BEFORE UPDATE OR DELETE ON result_known_issues
FOR EACH ROW EXECUTE FUNCTION helm_prevent_fact_mutation();

CREATE FUNCTION helm_validate_result_fact_counts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_result_id uuid;
  expected execution_results%ROWTYPE;
  actual_artifact_count bigint;
  actual_test_count bigint;
  actual_test_artifact_link_count bigint;
  actual_known_issue_count bigint;
BEGIN
  IF TG_ARGV[0] = 'result' THEN
    target_result_id := NEW.id;
  ELSE
    target_result_id := NEW.result_id;
  END IF;

  SELECT * INTO expected FROM execution_results WHERE id = target_result_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'result % does not exist', target_result_id;
  END IF;

  SELECT count(*) INTO actual_artifact_count
    FROM result_artifacts WHERE result_id = target_result_id;
  SELECT count(*) INTO actual_test_count
    FROM execution_test_results WHERE result_id = target_result_id;
  SELECT count(*) INTO actual_test_artifact_link_count
    FROM test_result_artifacts WHERE result_id = target_result_id;
  SELECT count(*) INTO actual_known_issue_count
    FROM result_known_issues WHERE result_id = target_result_id;

  IF actual_artifact_count <> expected.artifact_count
    OR actual_test_count <> expected.test_count
    OR actual_test_artifact_link_count <> expected.test_artifact_link_count
    OR actual_known_issue_count <> expected.known_issue_count
  THEN
    RAISE EXCEPTION 'result % fact counts do not match its immutable contract', target_result_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER validate_result_fact_counts_from_result
AFTER INSERT ON execution_results
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION helm_validate_result_fact_counts('result');

CREATE CONSTRAINT TRIGGER validate_result_fact_counts_from_artifact
AFTER INSERT ON result_artifacts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION helm_validate_result_fact_counts('child');

CREATE CONSTRAINT TRIGGER validate_result_fact_counts_from_test
AFTER INSERT ON execution_test_results
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION helm_validate_result_fact_counts('child');

CREATE CONSTRAINT TRIGGER validate_result_fact_counts_from_test_artifact
AFTER INSERT ON test_result_artifacts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION helm_validate_result_fact_counts('child');

CREATE CONSTRAINT TRIGGER validate_result_fact_counts_from_known_issue
AFTER INSERT ON result_known_issues
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION helm_validate_result_fact_counts('child');

CREATE FUNCTION helm_validate_execution_result()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bound_execution manual_executions%ROWTYPE;
BEGIN
  SELECT * INTO bound_execution
  FROM manual_executions
  WHERE id = NEW.execution_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'execution % does not exist', NEW.execution_id;
  END IF;
  IF bound_execution.status NOT IN ('completed', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'execution % is not terminal', NEW.execution_id;
  END IF;
  IF bound_execution.status <> NEW.outcome
    OR bound_execution.work_item_id <> NEW.work_item_id
  THEN
    RAISE EXCEPTION 'result does not match execution %', NEW.execution_id;
  END IF;
  IF NEW.created_at < bound_execution.started_at THEN
    RAISE EXCEPTION 'result predates execution %', NEW.execution_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_execution_result
BEFORE INSERT ON execution_results
FOR EACH ROW EXECUTE FUNCTION helm_validate_execution_result();
