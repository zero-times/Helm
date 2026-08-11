BEGIN;

INSERT INTO manual_executions (
  id,
  work_item_id,
  graph_version,
  mode,
  executor_member_id,
  status,
  started_at,
  updated_at,
  ended_at,
  version
) VALUES
  (
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    7,
    'self',
    '00000000-0000-4000-8000-000000000002',
    'completed',
    '2026-08-11T03:00:00.000Z',
    '2026-08-11T03:10:00.000Z',
    '2026-08-11T03:10:00.000Z',
    2
  ),
  (
    '00000000-0000-4000-8000-000000000111',
    '00000000-0000-4000-8000-000000000011',
    8,
    'self',
    '00000000-0000-4000-8000-000000000002',
    'completed',
    '2026-08-11T04:00:00.000Z',
    '2026-08-11T04:10:00.000Z',
    '2026-08-11T04:10:00.000Z',
    2
  );

INSERT INTO execution_results (
  id,
  execution_id,
  work_item_id,
  outcome,
  summary,
  verification_source,
  created_at,
  artifact_count,
  test_count,
  test_artifact_link_count,
  known_issue_count
) VALUES
  (
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    'completed',
    'Approved attempt',
    'human_verified',
    '2026-08-11T03:10:00.000Z',
    0,
    0,
    0,
    0
  ),
  (
    '00000000-0000-4000-8000-000000000211',
    '00000000-0000-4000-8000-000000000111',
    '00000000-0000-4000-8000-000000000011',
    'completed',
    'Rejected attempt',
    'human_verified',
    '2026-08-11T04:10:00.000Z',
    0,
    0,
    0,
    0
  );

INSERT INTO reviews (
  id,
  result_id,
  execution_id,
  work_item_id,
  graph_version,
  reviewer_member_id,
  requested_at
) VALUES
  (
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000001',
    7,
    '00000000-0000-4000-8000-000000000003',
    '2026-08-11T03:11:00.000Z'
  ),
  (
    '00000000-0000-4000-8000-000000000311',
    '00000000-0000-4000-8000-000000000211',
    '00000000-0000-4000-8000-000000000111',
    '00000000-0000-4000-8000-000000000011',
    8,
    '00000000-0000-4000-8000-000000000003',
    '2026-08-11T04:11:00.000Z'
  );

INSERT INTO human_gates (
  id,
  review_id,
  work_item_id,
  graph_version,
  opened_at
) VALUES
  (
    '00000000-0000-4000-8000-000000000401',
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000001',
    7,
    '2026-08-11T03:11:00.000Z'
  ),
  (
    '00000000-0000-4000-8000-000000000411',
    '00000000-0000-4000-8000-000000000311',
    '00000000-0000-4000-8000-000000000011',
    8,
    '2026-08-11T04:11:00.000Z'
  );

UPDATE reviews
SET
  status = 'approved',
  decided_at = '2026-08-11T03:12:00.000Z',
  decision_comment = 'Accepted',
  version = 2
WHERE id = '00000000-0000-4000-8000-000000000301';

UPDATE human_gates
SET
  status = 'passed',
  resolved_at = '2026-08-11T03:12:00.000Z',
  version = 2
WHERE id = '00000000-0000-4000-8000-000000000401';

UPDATE reviews
SET
  status = 'rejected',
  decided_at = '2026-08-11T04:12:00.000Z',
  decision_comment = 'Add rollback verification.',
  version = 2
WHERE id = '00000000-0000-4000-8000-000000000311';

UPDATE human_gates
SET
  status = 'rework_required',
  resolved_at = '2026-08-11T04:12:00.000Z',
  version = 2
WHERE id = '00000000-0000-4000-8000-000000000411';

INSERT INTO rework_requests (
  id,
  rejected_review_id,
  previous_execution_id,
  previous_result_id,
  work_item_id,
  graph_version,
  reason,
  requested_at
) VALUES (
  '00000000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000311',
  '00000000-0000-4000-8000-000000000111',
  '00000000-0000-4000-8000-000000000211',
  '00000000-0000-4000-8000-000000000011',
  8,
  'Add rollback verification.',
  '2026-08-11T04:12:00.000Z'
);

INSERT INTO manual_executions (
  id,
  work_item_id,
  graph_version,
  mode,
  executor_member_id,
  status,
  started_at,
  updated_at,
  version
) VALUES (
  '00000000-0000-4000-8000-000000000112',
  '00000000-0000-4000-8000-000000000011',
  8,
  'self',
  '00000000-0000-4000-8000-000000000002',
  'running',
  '2026-08-11T04:13:00.000Z',
  '2026-08-11T04:13:00.000Z',
  1
);

UPDATE rework_requests
SET
  status = 'started',
  new_execution_id = '00000000-0000-4000-8000-000000000112',
  started_at = '2026-08-11T04:13:00.000Z',
  version = 2
WHERE id = '00000000-0000-4000-8000-000000000501';

SET CONSTRAINTS ALL IMMEDIATE;

DO $$
DECLARE
  immutable_error boolean := false;
  original_status helm_manual_execution_status;
  original_summary text;
BEGIN
  IF (SELECT status FROM human_gates WHERE id = '00000000-0000-4000-8000-000000000401') <> 'passed' THEN
    RAISE EXCEPTION 'approved Review did not pass its Human gate';
  END IF;
  IF (SELECT status FROM human_gates WHERE id = '00000000-0000-4000-8000-000000000411') <> 'rework_required' THEN
    RAISE EXCEPTION 'rejected Review did not block its Human gate';
  END IF;
  IF (SELECT new_execution_id FROM rework_requests WHERE id = '00000000-0000-4000-8000-000000000501')
    <> '00000000-0000-4000-8000-000000000112'::uuid
  THEN
    RAISE EXCEPTION 'Rework request did not link its new Execution';
  END IF;

  SELECT status INTO original_status
  FROM manual_executions
  WHERE id = '00000000-0000-4000-8000-000000000111';
  SELECT summary INTO original_summary
  FROM execution_results
  WHERE id = '00000000-0000-4000-8000-000000000211';
  IF original_status <> 'completed' OR original_summary <> 'Rejected attempt' THEN
    RAISE EXCEPTION 'historical Execution or Result changed during Rework';
  END IF;

  BEGIN
    UPDATE reviews
    SET decision_comment = 'overwrite', version = 3
    WHERE id = '00000000-0000-4000-8000-000000000311';
  EXCEPTION WHEN others THEN
    immutable_error := true;
  END;
  IF NOT immutable_error THEN
    RAISE EXCEPTION 'terminal Review mutation was not rejected';
  END IF;
END;
$$;

ROLLBACK;
