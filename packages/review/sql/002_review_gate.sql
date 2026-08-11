BEGIN;

CREATE TYPE helm_review_status AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE helm_human_gate_status AS ENUM (
  'pending',
  'passed',
  'rework_required'
);
CREATE TYPE helm_rework_status AS ENUM ('requested', 'started');

CREATE TABLE reviews (
  id uuid PRIMARY KEY,
  result_id uuid NOT NULL UNIQUE REFERENCES execution_results(id) ON DELETE RESTRICT,
  execution_id uuid NOT NULL REFERENCES manual_executions(id) ON DELETE RESTRICT,
  work_item_id uuid NOT NULL,
  graph_version integer NOT NULL CHECK (graph_version > 0),
  reviewer_member_id uuid NOT NULL,
  status helm_review_status NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL,
  decided_at timestamptz,
  decision_comment text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT reviews_decision_check CHECK (
    (
      status = 'pending'
      AND decided_at IS NULL
      AND decision_comment IS NULL
    )
    OR (
      status = 'approved'
      AND decided_at IS NOT NULL
    )
    OR (
      status = 'rejected'
      AND decided_at IS NOT NULL
      AND length(btrim(decision_comment)) > 0
    )
  ),
  CONSTRAINT reviews_time_check CHECK (
    decided_at IS NULL OR decided_at >= requested_at
  )
);

CREATE INDEX reviews_work_item_requested_idx
  ON reviews (work_item_id, requested_at, id);

CREATE TABLE human_gates (
  id uuid PRIMARY KEY,
  review_id uuid NOT NULL UNIQUE REFERENCES reviews(id) ON DELETE RESTRICT,
  work_item_id uuid NOT NULL,
  graph_version integer NOT NULL CHECK (graph_version > 0),
  status helm_human_gate_status NOT NULL DEFAULT 'pending',
  opened_at timestamptz NOT NULL,
  resolved_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT human_gates_resolution_check CHECK (
    (status = 'pending' AND resolved_at IS NULL)
    OR (status IN ('passed', 'rework_required') AND resolved_at IS NOT NULL)
  ),
  CONSTRAINT human_gates_time_check CHECK (
    resolved_at IS NULL OR resolved_at >= opened_at
  )
);

CREATE INDEX human_gates_work_item_opened_idx
  ON human_gates (work_item_id, opened_at, id);

CREATE TABLE rework_requests (
  id uuid PRIMARY KEY,
  rejected_review_id uuid NOT NULL UNIQUE REFERENCES reviews(id) ON DELETE RESTRICT,
  previous_execution_id uuid NOT NULL REFERENCES manual_executions(id) ON DELETE RESTRICT,
  previous_result_id uuid NOT NULL REFERENCES execution_results(id) ON DELETE RESTRICT,
  work_item_id uuid NOT NULL,
  graph_version integer NOT NULL CHECK (graph_version > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  status helm_rework_status NOT NULL DEFAULT 'requested',
  requested_at timestamptz NOT NULL,
  new_execution_id uuid UNIQUE REFERENCES manual_executions(id) ON DELETE RESTRICT,
  started_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CONSTRAINT rework_requests_start_check CHECK (
    (
      status = 'requested'
      AND new_execution_id IS NULL
      AND started_at IS NULL
    )
    OR (
      status = 'started'
      AND new_execution_id IS NOT NULL
      AND started_at IS NOT NULL
    )
  ),
  CONSTRAINT rework_requests_time_check CHECK (
    started_at IS NULL OR started_at >= requested_at
  )
);

CREATE INDEX rework_requests_work_item_requested_idx
  ON rework_requests (work_item_id, requested_at, id);

CREATE FUNCTION helm_validate_review_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bound_execution manual_executions%ROWTYPE;
  bound_result execution_results%ROWTYPE;
BEGIN
  SELECT * INTO bound_execution
  FROM manual_executions
  WHERE id = NEW.execution_id;
  SELECT * INTO bound_result
  FROM execution_results
  WHERE id = NEW.result_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'review result % does not exist', NEW.result_id;
  END IF;
  IF bound_execution.id IS NULL THEN
    RAISE EXCEPTION 'review execution % does not exist', NEW.execution_id;
  END IF;
  IF bound_execution.status <> 'completed'
    OR bound_result.outcome <> 'completed'
    OR bound_result.execution_id <> bound_execution.id
    OR bound_result.work_item_id <> bound_execution.work_item_id
    OR NEW.work_item_id <> bound_execution.work_item_id
    OR NEW.graph_version <> bound_execution.graph_version
  THEN
    RAISE EXCEPTION 'review must bind one completed matching Execution Result';
  END IF;
  IF NEW.requested_at < bound_result.created_at THEN
    RAISE EXCEPTION 'review predates Result %', NEW.result_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_review_binding
BEFORE INSERT ON reviews
FOR EACH ROW EXECUTE FUNCTION helm_validate_review_binding();

CREATE FUNCTION helm_guard_review_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'terminal Review % is immutable', OLD.id;
  END IF;
  IF NEW.id <> OLD.id
    OR NEW.result_id <> OLD.result_id
    OR NEW.execution_id <> OLD.execution_id
    OR NEW.work_item_id <> OLD.work_item_id
    OR NEW.graph_version <> OLD.graph_version
    OR NEW.reviewer_member_id <> OLD.reviewer_member_id
    OR NEW.requested_at <> OLD.requested_at
  THEN
    RAISE EXCEPTION 'Review identity fields are immutable';
  END IF;
  IF NEW.status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid Review transition: % -> %', OLD.status, NEW.status;
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Review version must increment exactly once';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_review_update
BEFORE UPDATE ON reviews
FOR EACH ROW EXECUTE FUNCTION helm_guard_review_update();

CREATE FUNCTION helm_validate_human_gate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bound_review reviews%ROWTYPE;
BEGIN
  SELECT * INTO bound_review FROM reviews WHERE id = NEW.review_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review % does not exist', NEW.review_id;
  END IF;
  IF NEW.work_item_id <> bound_review.work_item_id
    OR NEW.graph_version <> bound_review.graph_version
    OR NEW.opened_at <> bound_review.requested_at
  THEN
    RAISE EXCEPTION 'Human gate does not match Review %', NEW.review_id;
  END IF;
  IF (NEW.status = 'pending' AND bound_review.status <> 'pending')
    OR (NEW.status = 'passed' AND bound_review.status <> 'approved')
    OR (
      NEW.status = 'rework_required'
      AND bound_review.status <> 'rejected'
    )
  THEN
    RAISE EXCEPTION 'Human gate and Review decisions disagree';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_human_gate_insert
BEFORE INSERT ON human_gates
FOR EACH ROW EXECUTE FUNCTION helm_validate_human_gate();

CREATE FUNCTION helm_guard_human_gate_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'resolved Human gate % is immutable', OLD.id;
  END IF;
  IF NEW.id <> OLD.id
    OR NEW.review_id <> OLD.review_id
    OR NEW.work_item_id <> OLD.work_item_id
    OR NEW.graph_version <> OLD.graph_version
    OR NEW.opened_at <> OLD.opened_at
  THEN
    RAISE EXCEPTION 'Human gate identity fields are immutable';
  END IF;
  IF NEW.status NOT IN ('passed', 'rework_required') THEN
    RAISE EXCEPTION 'invalid Human gate transition: % -> %', OLD.status, NEW.status;
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Human gate version must increment exactly once';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_human_gate_update
BEFORE UPDATE ON human_gates
FOR EACH ROW EXECUTE FUNCTION helm_guard_human_gate_update();

CREATE TRIGGER validate_human_gate_update
BEFORE UPDATE ON human_gates
FOR EACH ROW EXECUTE FUNCTION helm_validate_human_gate();

CREATE FUNCTION helm_validate_rework_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  rejected_review reviews%ROWTYPE;
BEGIN
  SELECT * INTO rejected_review
  FROM reviews
  WHERE id = NEW.rejected_review_id;
  IF NOT FOUND OR rejected_review.status <> 'rejected' THEN
    RAISE EXCEPTION 'Rework requires a rejected Review';
  END IF;
  IF NEW.previous_execution_id <> rejected_review.execution_id
    OR NEW.previous_result_id <> rejected_review.result_id
    OR NEW.work_item_id <> rejected_review.work_item_id
    OR NEW.graph_version <> rejected_review.graph_version
    OR NEW.reason <> rejected_review.decision_comment
    OR NEW.requested_at <> rejected_review.decided_at
  THEN
    RAISE EXCEPTION 'Rework request does not match rejected Review %', rejected_review.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_rework_insert
BEFORE INSERT ON rework_requests
FOR EACH ROW EXECUTE FUNCTION helm_validate_rework_insert();

CREATE FUNCTION helm_guard_rework_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  new_execution manual_executions%ROWTYPE;
BEGIN
  IF OLD.status <> 'requested' OR NEW.status <> 'started' THEN
    RAISE EXCEPTION 'invalid Rework transition: % -> %', OLD.status, NEW.status;
  END IF;
  IF NEW.id <> OLD.id
    OR NEW.rejected_review_id <> OLD.rejected_review_id
    OR NEW.previous_execution_id <> OLD.previous_execution_id
    OR NEW.previous_result_id <> OLD.previous_result_id
    OR NEW.work_item_id <> OLD.work_item_id
    OR NEW.graph_version <> OLD.graph_version
    OR NEW.reason <> OLD.reason
    OR NEW.requested_at <> OLD.requested_at
  THEN
    RAISE EXCEPTION 'Rework identity fields are immutable';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Rework version must increment exactly once';
  END IF;
  SELECT * INTO new_execution
  FROM manual_executions
  WHERE id = NEW.new_execution_id;
  IF NOT FOUND
    OR new_execution.id = NEW.previous_execution_id
    OR new_execution.work_item_id <> NEW.work_item_id
    OR new_execution.graph_version <> NEW.graph_version
    OR new_execution.started_at <> NEW.started_at
    OR new_execution.started_at < NEW.requested_at
  THEN
    RAISE EXCEPTION 'new Rework Execution does not match request %', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_rework_update
BEFORE UPDATE ON rework_requests
FOR EACH ROW EXECUTE FUNCTION helm_guard_rework_update();

CREATE FUNCTION helm_validate_review_resolution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_review_id uuid;
  target_review reviews%ROWTYPE;
  target_gate human_gates%ROWTYPE;
  rework_count bigint;
BEGIN
  IF TG_TABLE_NAME = 'reviews' THEN
    target_review_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'human_gates' THEN
    target_review_id := NEW.review_id;
  ELSE
    target_review_id := NEW.rejected_review_id;
  END IF;

  SELECT * INTO target_review FROM reviews WHERE id = target_review_id;
  SELECT * INTO target_gate FROM human_gates WHERE review_id = target_review_id;
  SELECT count(*) INTO rework_count
  FROM rework_requests
  WHERE rejected_review_id = target_review_id;

  IF target_review.id IS NULL OR target_gate.id IS NULL THEN
    RAISE EXCEPTION 'Review % must own one Human gate', target_review_id;
  END IF;
  IF (target_review.status = 'pending' AND target_gate.status <> 'pending')
    OR (target_review.status = 'approved' AND target_gate.status <> 'passed')
    OR (
      target_review.status = 'rejected'
      AND target_gate.status <> 'rework_required'
    )
  THEN
    RAISE EXCEPTION 'Review % and its Human gate disagree', target_review_id;
  END IF;
  IF (target_review.status = 'rejected' AND rework_count <> 1)
    OR (target_review.status <> 'rejected' AND rework_count <> 0)
  THEN
    RAISE EXCEPTION 'Review % has an invalid Rework path count', target_review_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER validate_review_resolution_from_review
AFTER INSERT OR UPDATE ON reviews
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION helm_validate_review_resolution();

CREATE CONSTRAINT TRIGGER validate_review_resolution_from_gate
AFTER INSERT OR UPDATE ON human_gates
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION helm_validate_review_resolution();

CREATE CONSTRAINT TRIGGER validate_review_resolution_from_rework
AFTER INSERT OR UPDATE ON rework_requests
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION helm_validate_review_resolution();

CREATE FUNCTION helm_prevent_review_fact_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Review, Human gate, and Rework facts are immutable';
END;
$$;

CREATE TRIGGER prevent_review_delete
BEFORE DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION helm_prevent_review_fact_delete();

CREATE TRIGGER prevent_human_gate_delete
BEFORE DELETE ON human_gates
FOR EACH ROW EXECUTE FUNCTION helm_prevent_review_fact_delete();

CREATE TRIGGER prevent_rework_delete
BEFORE DELETE ON rework_requests
FOR EACH ROW EXECUTE FUNCTION helm_prevent_review_fact_delete();

COMMIT;
