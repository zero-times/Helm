BEGIN;

INSERT INTO bug_work_items (
  id, source_requirement_id, graph_version, title, description,
  discovered_in, severity, blocking, reporter_member_id,
  created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  3,
  'Release loses audit entries',
  'The release path drops the final audit event.',
  'qa',
  'critical',
  true,
  '00000000-0000-4000-8000-000000000003',
  '2026-08-11T04:00:00.000Z',
  '2026-08-11T04:00:00.000Z'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM bug_work_items
    WHERE source_requirement_id = '00000000-0000-4000-8000-000000000001'
      AND blocking AND status <> 'closed'
  ) THEN
    RAISE EXCEPTION 'blocking Bug was not queryable';
  END IF;
END;
$$;

UPDATE bug_work_items
SET status = 'fix_in_progress',
    updated_at = '2026-08-11T04:01:00.000Z',
    version = 2
WHERE id = '00000000-0000-4000-8000-000000000002' AND version = 1;

INSERT INTO bug_fix_edges (
  id, bug_id, execution_id, result_id, review_id, passed_gate_id, fixed_at
) VALUES (
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000005',
  '00000000-0000-4000-8000-000000000006',
  '00000000-0000-4000-8000-000000000007',
  '00000000-0000-4000-8000-000000000008',
  '2026-08-11T04:02:00.000Z'
);

INSERT INTO qa_regression_edges (
  id, bug_id, fix_edge_id, qa_member_id, requested_at
) VALUES (
  '00000000-0000-4000-8000-000000000009',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000004',
  '00000000-0000-4000-8000-000000000003',
  '2026-08-11T04:02:00.000Z'
);

UPDATE bug_work_items
SET status = 'awaiting_qa',
    updated_at = '2026-08-11T04:02:00.000Z',
    version = 3
WHERE id = '00000000-0000-4000-8000-000000000002' AND version = 2;

UPDATE qa_regression_edges
SET status = 'passed',
    completed_at = '2026-08-11T04:03:00.000Z',
    notes = 'Regression passed.',
    version = 2
WHERE id = '00000000-0000-4000-8000-000000000009' AND version = 1;

UPDATE bug_work_items
SET status = 'closed',
    blocking = false,
    updated_at = '2026-08-11T04:03:00.000Z',
    closed_at = '2026-08-11T04:03:00.000Z',
    version = 4
WHERE id = '00000000-0000-4000-8000-000000000002' AND version = 3;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM bug_work_items
    WHERE source_requirement_id = '00000000-0000-4000-8000-000000000001'
      AND blocking AND status <> 'closed'
  ) THEN
    RAISE EXCEPTION 'passed regression did not clear the release block';
  END IF;

  BEGIN
    UPDATE bug_fix_edges
    SET result_id = '00000000-0000-4000-8000-999999999999'
    WHERE id = '00000000-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'immutable fix edge accepted an update';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'immutable fix edge accepted an update' THEN
      RAISE;
    END IF;
  END;
END;
$$;

ROLLBACK;
