CREATE TYPE "public"."helm_artifact_kind" AS ENUM('file', 'url', 'commit', 'patch', 'log', 'report', 'other');--> statement-breakpoint
CREATE TYPE "public"."helm_test_status" AS ENUM('passed', 'failed', 'skipped', 'not_run');--> statement-breakpoint
CREATE TYPE "public"."helm_issue_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."helm_manual_execution_mode" AS ENUM('self', 'external_manual');--> statement-breakpoint
CREATE TYPE "public"."helm_manual_execution_status" AS ENUM('running', 'waiting_for_input', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."helm_verification_source" AS ENUM('unverified', 'agent_reported', 'runner_verified', 'ci_verified', 'human_verified');--> statement-breakpoint
CREATE TABLE "execution_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"execution_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"outcome" "helm_manual_execution_status" NOT NULL,
	"summary" text NOT NULL,
	"changed_files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"change_set" jsonb,
	"commit_reference" text,
	"needs_human_decision" boolean DEFAULT false NOT NULL,
	"human_decision" jsonb,
	"session_reference" jsonb,
	"actual_cost" jsonb,
	"duration_ms" bigint,
	"verification_source" "helm_verification_source" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"artifact_count" integer NOT NULL,
	"test_count" integer NOT NULL,
	"test_artifact_link_count" integer NOT NULL,
	"known_issue_count" integer NOT NULL,
	CONSTRAINT "execution_results_execution_id_unique" UNIQUE("execution_id"),
	CONSTRAINT "execution_results_terminal_outcome" CHECK ("execution_results"."outcome" IN ('completed', 'failed', 'cancelled')),
	CONSTRAINT "execution_results_summary_non_blank" CHECK (length(btrim("execution_results"."summary")) > 0),
	CONSTRAINT "execution_results_changed_files_array" CHECK (jsonb_typeof("execution_results"."changed_files") = 'array'),
	CONSTRAINT "execution_results_duration_non_negative" CHECK ("execution_results"."duration_ms" IS NULL OR "execution_results"."duration_ms" >= 0),
	CONSTRAINT "execution_results_artifact_count_non_negative" CHECK ("execution_results"."artifact_count" >= 0),
	CONSTRAINT "execution_results_test_count_non_negative" CHECK ("execution_results"."test_count" >= 0),
	CONSTRAINT "execution_results_link_count_non_negative" CHECK ("execution_results"."test_artifact_link_count" >= 0),
	CONSTRAINT "execution_results_issue_count_non_negative" CHECK ("execution_results"."known_issue_count" >= 0),
	CONSTRAINT "execution_results_decision_check" CHECK ("execution_results"."needs_human_decision" = ("execution_results"."human_decision" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "execution_test_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"result_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "helm_test_status" NOT NULL,
	"command" text,
	"details" text,
	CONSTRAINT "execution_test_results_result_id_id_unique" UNIQUE("result_id","id"),
	CONSTRAINT "execution_test_results_name_non_blank" CHECK (length(btrim("execution_test_results"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "manual_executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_item_id" uuid NOT NULL,
	"graph_version" integer NOT NULL,
	"mode" "helm_manual_execution_mode" NOT NULL,
	"executor_member_id" uuid NOT NULL,
	"status" "helm_manual_execution_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"waiting_reason" text,
	"end_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "manual_executions_graph_version_positive" CHECK ("manual_executions"."graph_version" > 0),
	CONSTRAINT "manual_executions_version_positive" CHECK ("manual_executions"."version" > 0),
	CONSTRAINT "manual_executions_lifecycle_check" CHECK ((
        ("manual_executions"."status" = 'running' AND "manual_executions"."ended_at" IS NULL AND "manual_executions"."waiting_reason" IS NULL)
        OR ("manual_executions"."status" = 'waiting_for_input' AND "manual_executions"."ended_at" IS NULL AND "manual_executions"."waiting_reason" IS NOT NULL)
        OR ("manual_executions"."status" = 'completed' AND "manual_executions"."ended_at" IS NOT NULL AND "manual_executions"."waiting_reason" IS NULL)
        OR ("manual_executions"."status" IN ('failed', 'cancelled') AND "manual_executions"."ended_at" IS NOT NULL AND "manual_executions"."waiting_reason" IS NULL AND "manual_executions"."end_reason" IS NOT NULL)
      )),
	CONSTRAINT "manual_executions_time_check" CHECK ("manual_executions"."updated_at" >= "manual_executions"."started_at" AND ("manual_executions"."ended_at" IS NULL OR "manual_executions"."ended_at" >= "manual_executions"."started_at"))
);
--> statement-breakpoint
CREATE TABLE "result_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"result_id" uuid NOT NULL,
	"kind" "helm_artifact_kind" NOT NULL,
	"name" text NOT NULL,
	"uri" text NOT NULL,
	"media_type" text,
	"digest_algorithm" text,
	"digest_value" text,
	"size_bytes" bigint,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "result_artifacts_result_id_id_unique" UNIQUE("result_id","id"),
	CONSTRAINT "result_artifacts_name_non_blank" CHECK (length(btrim("result_artifacts"."name")) > 0),
	CONSTRAINT "result_artifacts_uri_non_blank" CHECK (length(btrim("result_artifacts"."uri")) > 0),
	CONSTRAINT "result_artifacts_digest_algorithm" CHECK ("result_artifacts"."digest_algorithm" IS NULL OR "result_artifacts"."digest_algorithm" = 'sha256'),
	CONSTRAINT "result_artifacts_digest_pair" CHECK (("result_artifacts"."digest_algorithm" IS NULL) = ("result_artifacts"."digest_value" IS NULL)),
	CONSTRAINT "result_artifacts_size_non_negative" CHECK ("result_artifacts"."size_bytes" IS NULL OR "result_artifacts"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "result_known_issues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"result_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"severity" "helm_issue_severity" NOT NULL,
	"blocking" boolean NOT NULL,
	CONSTRAINT "result_known_issues_result_id_id_unique" UNIQUE("result_id","id"),
	CONSTRAINT "result_known_issues_title_non_blank" CHECK (length(btrim("result_known_issues"."title")) > 0),
	CONSTRAINT "result_known_issues_description_non_blank" CHECK (length(btrim("result_known_issues"."description")) > 0)
);
--> statement-breakpoint
CREATE TABLE "test_result_artifacts" (
	"result_id" uuid NOT NULL,
	"test_result_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	CONSTRAINT "test_result_artifacts_test_result_id_artifact_id_pk" PRIMARY KEY("test_result_id","artifact_id")
);
--> statement-breakpoint
ALTER TABLE "execution_results" ADD CONSTRAINT "execution_results_execution_id_manual_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."manual_executions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_results" ADD CONSTRAINT "execution_results_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_test_results" ADD CONSTRAINT "execution_test_results_result_id_execution_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."execution_results"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_executions" ADD CONSTRAINT "manual_executions_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_executions" ADD CONSTRAINT "manual_executions_executor_member_id_members_id_fk" FOREIGN KEY ("executor_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_artifacts" ADD CONSTRAINT "result_artifacts_result_id_execution_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."execution_results"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_known_issues" ADD CONSTRAINT "result_known_issues_result_id_execution_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."execution_results"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result_artifacts" ADD CONSTRAINT "test_result_artifacts_test_fk" FOREIGN KEY ("result_id","test_result_id") REFERENCES "public"."execution_test_results"("result_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_result_artifacts" ADD CONSTRAINT "test_result_artifacts_artifact_fk" FOREIGN KEY ("result_id","artifact_id") REFERENCES "public"."result_artifacts"("result_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "execution_results_work_item_created_idx" ON "execution_results" USING btree ("work_item_id","created_at","id");--> statement-breakpoint
CREATE INDEX "manual_executions_work_item_started_idx" ON "manual_executions" USING btree ("work_item_id","started_at","id");
--> statement-breakpoint
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
    (OLD.status = 'running' AND NEW.status IN ('waiting_for_input', 'completed', 'failed', 'cancelled'))
    OR (OLD.status = 'waiting_for_input' AND NEW.status IN ('running', 'completed', 'failed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'invalid manual execution transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guard_manual_execution_update
BEFORE UPDATE ON manual_executions
FOR EACH ROW EXECUTE FUNCTION helm_guard_manual_execution_update();
--> statement-breakpoint
CREATE FUNCTION helm_validate_manual_execution_start()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_status work_item_status;
  current_graph_version integer;
BEGIN
  SELECT wi.status, wg.graph_version
  INTO current_status, current_graph_version
  FROM work_items wi
  JOIN graph_nodes gn ON gn.id = wi.graph_node_id
  JOIN work_graphs wg ON wg.id = gn.graph_id
  WHERE wi.id = NEW.work_item_id
  FOR UPDATE OF wi;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'work item % does not exist', NEW.work_item_id;
  END IF;
  IF current_status <> 'ready' THEN
    RAISE EXCEPTION 'work item % must be ready to start execution', NEW.work_item_id;
  END IF;
  IF current_graph_version <> NEW.graph_version THEN
    RAISE EXCEPTION 'execution graph version % does not match current version %', NEW.graph_version, current_graph_version;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER validate_manual_execution_start
BEFORE INSERT ON manual_executions
FOR EACH ROW EXECUTE FUNCTION helm_validate_manual_execution_start();
--> statement-breakpoint
CREATE FUNCTION helm_prevent_execution_fact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'historical execution result facts are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER prevent_manual_execution_delete
BEFORE DELETE ON manual_executions
FOR EACH ROW EXECUTE FUNCTION helm_prevent_execution_fact_mutation();
--> statement-breakpoint
CREATE TRIGGER prevent_execution_result_mutation
BEFORE UPDATE OR DELETE ON execution_results
FOR EACH ROW EXECUTE FUNCTION helm_prevent_execution_fact_mutation();
--> statement-breakpoint
CREATE TRIGGER prevent_result_artifact_mutation
BEFORE UPDATE OR DELETE ON result_artifacts
FOR EACH ROW EXECUTE FUNCTION helm_prevent_execution_fact_mutation();
--> statement-breakpoint
CREATE TRIGGER prevent_execution_test_result_mutation
BEFORE UPDATE OR DELETE ON execution_test_results
FOR EACH ROW EXECUTE FUNCTION helm_prevent_execution_fact_mutation();
--> statement-breakpoint
CREATE TRIGGER prevent_test_result_artifact_mutation
BEFORE UPDATE OR DELETE ON test_result_artifacts
FOR EACH ROW EXECUTE FUNCTION helm_prevent_execution_fact_mutation();
--> statement-breakpoint
CREATE TRIGGER prevent_result_known_issue_mutation
BEFORE UPDATE OR DELETE ON result_known_issues
FOR EACH ROW EXECUTE FUNCTION helm_prevent_execution_fact_mutation();
--> statement-breakpoint
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

  SELECT count(*) INTO actual_artifact_count FROM result_artifacts WHERE result_id = target_result_id;
  SELECT count(*) INTO actual_test_count FROM execution_test_results WHERE result_id = target_result_id;
  SELECT count(*) INTO actual_test_artifact_link_count FROM test_result_artifacts WHERE result_id = target_result_id;
  SELECT count(*) INTO actual_known_issue_count FROM result_known_issues WHERE result_id = target_result_id;

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
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER validate_result_fact_counts_from_result
AFTER INSERT ON execution_results
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION helm_validate_result_fact_counts('result');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER validate_result_fact_counts_from_artifact
AFTER INSERT ON result_artifacts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION helm_validate_result_fact_counts('child');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER validate_result_fact_counts_from_test
AFTER INSERT ON execution_test_results
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION helm_validate_result_fact_counts('child');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER validate_result_fact_counts_from_test_artifact
AFTER INSERT ON test_result_artifacts
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION helm_validate_result_fact_counts('child');
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER validate_result_fact_counts_from_known_issue
AFTER INSERT ON result_known_issues
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION helm_validate_result_fact_counts('child');
--> statement-breakpoint
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
  IF bound_execution.status <> NEW.outcome OR bound_execution.work_item_id <> NEW.work_item_id THEN
    RAISE EXCEPTION 'result does not match execution %', NEW.execution_id;
  END IF;
  IF NEW.created_at < bound_execution.started_at THEN
    RAISE EXCEPTION 'result predates execution %', NEW.execution_id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER validate_execution_result
BEFORE INSERT ON execution_results
FOR EACH ROW EXECUTE FUNCTION helm_validate_execution_result();
