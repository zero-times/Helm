CREATE TYPE bug_discovery_stage AS ENUM (
  'requirement', 'design', 'implementation', 'review', 'qa', 'release', 'production'
);
CREATE TYPE bug_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE bug_status AS ENUM ('open', 'fix_in_progress', 'awaiting_qa', 'closed');
CREATE TYPE qa_regression_status AS ENUM ('pending', 'passed', 'failed');

CREATE TABLE bug_work_items (
  id uuid PRIMARY KEY,
  source_requirement_id uuid NOT NULL,
  graph_version integer NOT NULL CHECK (graph_version > 0),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  discovered_in bug_discovery_stage NOT NULL,
  severity bug_severity NOT NULL,
  blocking boolean NOT NULL,
  reporter_member_id uuid NOT NULL,
  status bug_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  closed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (
    (status = 'closed' AND blocking = false AND closed_at IS NOT NULL)
    OR (status <> 'closed' AND closed_at IS NULL)
  )
);

CREATE INDEX bug_work_items_requirement_idx
  ON bug_work_items (source_requirement_id, status, blocking);

CREATE TABLE bug_fix_edges (
  id uuid PRIMARY KEY,
  bug_id uuid NOT NULL REFERENCES bug_work_items(id),
  execution_id uuid NOT NULL UNIQUE,
  result_id uuid NOT NULL UNIQUE,
  review_id uuid NOT NULL UNIQUE,
  passed_gate_id uuid NOT NULL UNIQUE,
  fixed_at timestamptz NOT NULL
);

CREATE TABLE qa_regression_edges (
  id uuid PRIMARY KEY,
  bug_id uuid NOT NULL REFERENCES bug_work_items(id),
  fix_edge_id uuid NOT NULL UNIQUE REFERENCES bug_fix_edges(id),
  qa_member_id uuid NOT NULL,
  status qa_regression_status NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL,
  completed_at timestamptz,
  notes text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK (
    (status = 'pending' AND completed_at IS NULL)
    OR (status IN ('passed', 'failed') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX qa_regression_edges_bug_idx
  ON qa_regression_edges (bug_id, requested_at);

CREATE FUNCTION reject_bug_edge_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER bug_fix_edges_immutable
  BEFORE UPDATE OR DELETE ON bug_fix_edges
  FOR EACH ROW EXECUTE FUNCTION reject_bug_edge_mutation();

CREATE FUNCTION protect_bug_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.source_requirement_id, NEW.graph_version, NEW.title,
      NEW.description, NEW.discovered_in, NEW.severity,
      NEW.reporter_member_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.source_requirement_id, OLD.graph_version, OLD.title,
      OLD.description, OLD.discovered_in, OLD.severity,
      OLD.reporter_member_id, OLD.created_at) THEN
    RAISE EXCEPTION 'Bug identity and source fields are immutable';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Bug version must increment exactly once';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bug_work_items_protect_identity
  BEFORE UPDATE ON bug_work_items
  FOR EACH ROW EXECUTE FUNCTION protect_bug_identity();

CREATE FUNCTION protect_qa_regression() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'pending' OR NEW.status NOT IN ('passed', 'failed') THEN
    RAISE EXCEPTION 'QA regression may transition only once from pending';
  END IF;
  IF (NEW.id, NEW.bug_id, NEW.fix_edge_id, NEW.qa_member_id, NEW.requested_at)
     IS DISTINCT FROM
     (OLD.id, OLD.bug_id, OLD.fix_edge_id, OLD.qa_member_id, OLD.requested_at) THEN
    RAISE EXCEPTION 'QA regression identity is immutable';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'QA regression version must increment exactly once';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER qa_regression_edges_protect_transition
  BEFORE UPDATE ON qa_regression_edges
  FOR EACH ROW EXECUTE FUNCTION protect_qa_regression();

CREATE TRIGGER qa_regression_edges_no_delete
  BEFORE DELETE ON qa_regression_edges
  FOR EACH ROW EXECUTE FUNCTION reject_bug_edge_mutation();

CREATE FUNCTION validate_bug_qa_consistency() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_bug_id uuid;
  current_bug bug_work_items%ROWTYPE;
  latest_regression qa_regression_edges%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'bug_work_items' THEN
    target_bug_id := COALESCE(NEW.id, OLD.id);
  ELSE
    target_bug_id := COALESCE(NEW.bug_id, OLD.bug_id);
  END IF;

  SELECT * INTO current_bug FROM bug_work_items WHERE id = target_bug_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM bug_fix_edges fix
    WHERE fix.bug_id = target_bug_id
      AND NOT EXISTS (
        SELECT 1 FROM qa_regression_edges regression
        WHERE regression.fix_edge_id = fix.id
          AND regression.bug_id = fix.bug_id
      )
  ) THEN
    RAISE EXCEPTION 'Every Bug fix edge requires a matching QA regression edge';
  END IF;

  SELECT * INTO latest_regression
  FROM qa_regression_edges
  WHERE bug_id = target_bug_id
  ORDER BY requested_at DESC, id DESC
  LIMIT 1;

  IF FOUND THEN
    IF latest_regression.status = 'pending'
       AND current_bug.status <> 'awaiting_qa' THEN
      RAISE EXCEPTION 'A pending QA regression requires an awaiting_qa Bug';
    ELSIF latest_regression.status = 'passed'
       AND (current_bug.status <> 'closed' OR current_bug.blocking) THEN
      RAISE EXCEPTION 'A passed QA regression must close and unblock its Bug';
    ELSIF latest_regression.status = 'failed'
       AND current_bug.status <> 'open' THEN
      RAISE EXCEPTION 'A failed QA regression must return its Bug to open';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER bug_work_items_consistent_with_qa
  AFTER INSERT OR UPDATE ON bug_work_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_bug_qa_consistency();

CREATE CONSTRAINT TRIGGER bug_fix_edges_consistent_with_qa
  AFTER INSERT ON bug_fix_edges
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_bug_qa_consistency();

CREATE CONSTRAINT TRIGGER qa_regression_edges_consistent_with_bug
  AFTER INSERT OR UPDATE ON qa_regression_edges
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_bug_qa_consistency();
