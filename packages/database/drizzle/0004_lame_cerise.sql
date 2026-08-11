CREATE TYPE "public"."helm_human_gate_status" AS ENUM('pending', 'passed', 'rework_required');--> statement-breakpoint
CREATE TYPE "public"."helm_review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."helm_rework_status" AS ENUM('requested', 'started');--> statement-breakpoint
CREATE TABLE "human_gates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"review_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"graph_version" integer NOT NULL,
	"status" "helm_human_gate_status" DEFAULT 'pending' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "human_gates_review_id_unique" UNIQUE("review_id"),
	CONSTRAINT "human_gates_graph_version_positive" CHECK ("human_gates"."graph_version" > 0),
	CONSTRAINT "human_gates_version_positive" CHECK ("human_gates"."version" > 0),
	CONSTRAINT "human_gates_resolution_check" CHECK ((
        ("human_gates"."status" = 'pending' AND "human_gates"."resolved_at" IS NULL)
        OR ("human_gates"."status" IN ('passed', 'rework_required') AND "human_gates"."resolved_at" IS NOT NULL)
      )),
	CONSTRAINT "human_gates_time_check" CHECK ("human_gates"."resolved_at" IS NULL OR "human_gates"."resolved_at" >= "human_gates"."opened_at")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"result_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"graph_version" integer NOT NULL,
	"reviewer_member_id" uuid NOT NULL,
	"status" "helm_review_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decision_comment" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "reviews_result_id_unique" UNIQUE("result_id"),
	CONSTRAINT "reviews_graph_version_positive" CHECK ("reviews"."graph_version" > 0),
	CONSTRAINT "reviews_version_positive" CHECK ("reviews"."version" > 0),
	CONSTRAINT "reviews_decision_check" CHECK ((
        ("reviews"."status" = 'pending' AND "reviews"."decided_at" IS NULL AND "reviews"."decision_comment" IS NULL)
        OR ("reviews"."status" = 'approved' AND "reviews"."decided_at" IS NOT NULL)
        OR ("reviews"."status" = 'rejected' AND "reviews"."decided_at" IS NOT NULL AND length(btrim("reviews"."decision_comment")) > 0)
      )),
	CONSTRAINT "reviews_time_check" CHECK ("reviews"."decided_at" IS NULL OR "reviews"."decided_at" >= "reviews"."requested_at")
);
--> statement-breakpoint
CREATE TABLE "rework_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rejected_review_id" uuid NOT NULL,
	"previous_execution_id" uuid NOT NULL,
	"previous_result_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"graph_version" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "helm_rework_status" DEFAULT 'requested' NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"new_execution_id" uuid,
	"started_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "rework_requests_rejected_review_unique" UNIQUE("rejected_review_id"),
	CONSTRAINT "rework_requests_new_execution_unique" UNIQUE("new_execution_id"),
	CONSTRAINT "rework_requests_graph_version_positive" CHECK ("rework_requests"."graph_version" > 0),
	CONSTRAINT "rework_requests_version_positive" CHECK ("rework_requests"."version" > 0),
	CONSTRAINT "rework_requests_reason_non_blank" CHECK (length(btrim("rework_requests"."reason")) > 0),
	CONSTRAINT "rework_requests_start_check" CHECK ((
        ("rework_requests"."status" = 'requested' AND "rework_requests"."new_execution_id" IS NULL AND "rework_requests"."started_at" IS NULL)
        OR ("rework_requests"."status" = 'started' AND "rework_requests"."new_execution_id" IS NOT NULL AND "rework_requests"."started_at" IS NOT NULL)
      )),
	CONSTRAINT "rework_requests_time_check" CHECK ("rework_requests"."started_at" IS NULL OR "rework_requests"."started_at" >= "rework_requests"."requested_at")
);
--> statement-breakpoint
ALTER TABLE "human_gates" ADD CONSTRAINT "human_gates_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_gates" ADD CONSTRAINT "human_gates_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_result_id_execution_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."execution_results"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_execution_id_manual_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."manual_executions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_member_id_members_id_fk" FOREIGN KEY ("reviewer_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rework_requests" ADD CONSTRAINT "rework_requests_rejected_review_id_reviews_id_fk" FOREIGN KEY ("rejected_review_id") REFERENCES "public"."reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rework_requests" ADD CONSTRAINT "rework_requests_previous_execution_id_manual_executions_id_fk" FOREIGN KEY ("previous_execution_id") REFERENCES "public"."manual_executions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rework_requests" ADD CONSTRAINT "rework_requests_previous_result_id_execution_results_id_fk" FOREIGN KEY ("previous_result_id") REFERENCES "public"."execution_results"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rework_requests" ADD CONSTRAINT "rework_requests_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rework_requests" ADD CONSTRAINT "rework_requests_new_execution_id_manual_executions_id_fk" FOREIGN KEY ("new_execution_id") REFERENCES "public"."manual_executions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "human_gates_work_item_opened_idx" ON "human_gates" USING btree ("work_item_id","opened_at","id");--> statement-breakpoint
CREATE INDEX "reviews_work_item_requested_idx" ON "reviews" USING btree ("work_item_id","requested_at","id");--> statement-breakpoint
CREATE INDEX "rework_requests_work_item_requested_idx" ON "rework_requests" USING btree ("work_item_id","requested_at","id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION helm_validate_review_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bound_execution manual_executions%ROWTYPE;
  bound_result execution_results%ROWTYPE;
  bound_work_item work_items%ROWTYPE;
  reviewer_type member_type;
  reviewer_organization uuid;
  work_item_organization uuid;
BEGIN
  SELECT * INTO bound_execution FROM manual_executions WHERE id = NEW.execution_id;
  SELECT * INTO bound_result FROM execution_results WHERE id = NEW.result_id;
  SELECT * INTO bound_work_item FROM work_items WHERE id = NEW.work_item_id FOR UPDATE;
  SELECT member_type, organization_id
  INTO reviewer_type, reviewer_organization
  FROM members
  WHERE id = NEW.reviewer_member_id;
  SELECT project.organization_id
  INTO work_item_organization
  FROM work_items item
  JOIN graph_nodes node ON node.id = item.graph_node_id
  JOIN work_graphs graph ON graph.id = node.graph_id
  JOIN requirements requirement ON requirement.id = graph.requirement_id
  JOIN projects project ON project.id = requirement.project_id
  WHERE item.id = NEW.work_item_id;

  IF bound_execution.id IS NULL OR bound_result.id IS NULL OR bound_work_item.id IS NULL THEN
    RAISE EXCEPTION 'Review must bind an existing Execution, Result, and WorkItem';
  END IF;
  IF bound_work_item.status <> 'in_progress' THEN
    RAISE EXCEPTION 'reviewed WorkItem % must be in_progress', NEW.work_item_id;
  END IF;
  IF reviewer_type IS DISTINCT FROM 'human'
    OR reviewer_organization IS DISTINCT FROM work_item_organization
  THEN
    RAISE EXCEPTION 'reviewer must be a Human in the WorkItem organization';
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
--> statement-breakpoint
CREATE TRIGGER validate_review_binding
BEFORE INSERT ON reviews
FOR EACH ROW EXECUTE FUNCTION helm_validate_review_binding();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION helm_guard_review_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'terminal Review % is immutable', OLD.id;
  END IF;
  IF NEW.id <> OLD.id OR NEW.result_id <> OLD.result_id
    OR NEW.execution_id <> OLD.execution_id OR NEW.work_item_id <> OLD.work_item_id
    OR NEW.graph_version <> OLD.graph_version OR NEW.reviewer_member_id <> OLD.reviewer_member_id
    OR NEW.requested_at <> OLD.requested_at
  THEN
    RAISE EXCEPTION 'Review identity fields are immutable';
  END IF;
  IF NEW.status NOT IN ('approved', 'rejected') OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'invalid Review transition or version';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guard_review_update
BEFORE UPDATE ON reviews
FOR EACH ROW EXECUTE FUNCTION helm_guard_review_update();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION helm_validate_human_gate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bound_review reviews%ROWTYPE;
BEGIN
  SELECT * INTO bound_review FROM reviews WHERE id = NEW.review_id;
  IF bound_review.id IS NULL
    OR NEW.work_item_id <> bound_review.work_item_id
    OR NEW.graph_version <> bound_review.graph_version
    OR NEW.opened_at <> bound_review.requested_at
  THEN
    RAISE EXCEPTION 'Human gate does not match Review %', NEW.review_id;
  END IF;
  IF (NEW.status = 'pending' AND bound_review.status <> 'pending')
    OR (NEW.status = 'passed' AND bound_review.status <> 'approved')
    OR (NEW.status = 'rework_required' AND bound_review.status <> 'rejected')
  THEN
    RAISE EXCEPTION 'Human gate and Review decisions disagree';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER validate_human_gate_insert
BEFORE INSERT ON human_gates
FOR EACH ROW EXECUTE FUNCTION helm_validate_human_gate();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION helm_guard_human_gate_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'resolved Human gate % is immutable', OLD.id;
  END IF;
  IF NEW.id <> OLD.id OR NEW.review_id <> OLD.review_id
    OR NEW.work_item_id <> OLD.work_item_id OR NEW.graph_version <> OLD.graph_version
    OR NEW.opened_at <> OLD.opened_at
  THEN
    RAISE EXCEPTION 'Human gate identity fields are immutable';
  END IF;
  IF NEW.status NOT IN ('passed', 'rework_required') OR NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'invalid Human gate transition or version';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guard_human_gate_update
BEFORE UPDATE ON human_gates
FOR EACH ROW EXECUTE FUNCTION helm_guard_human_gate_update();
--> statement-breakpoint
CREATE TRIGGER validate_human_gate_update
BEFORE UPDATE ON human_gates
FOR EACH ROW EXECUTE FUNCTION helm_validate_human_gate();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION helm_validate_rework_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  rejected_review reviews%ROWTYPE;
BEGIN
  SELECT * INTO rejected_review FROM reviews WHERE id = NEW.rejected_review_id;
  IF rejected_review.id IS NULL OR rejected_review.status <> 'rejected'
    OR NEW.previous_execution_id <> rejected_review.execution_id
    OR NEW.previous_result_id <> rejected_review.result_id
    OR NEW.work_item_id <> rejected_review.work_item_id
    OR NEW.graph_version <> rejected_review.graph_version
    OR NEW.reason <> rejected_review.decision_comment
    OR NEW.requested_at <> rejected_review.decided_at
  THEN
    RAISE EXCEPTION 'Rework request does not match rejected Review %', NEW.rejected_review_id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER validate_rework_insert
BEFORE INSERT ON rework_requests
FOR EACH ROW EXECUTE FUNCTION helm_validate_rework_insert();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION helm_guard_rework_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  new_execution manual_executions%ROWTYPE;
BEGIN
  IF OLD.status <> 'requested' OR NEW.status <> 'started'
    OR NEW.id <> OLD.id OR NEW.rejected_review_id <> OLD.rejected_review_id
    OR NEW.previous_execution_id <> OLD.previous_execution_id
    OR NEW.previous_result_id <> OLD.previous_result_id
    OR NEW.work_item_id <> OLD.work_item_id OR NEW.graph_version <> OLD.graph_version
    OR NEW.reason <> OLD.reason OR NEW.requested_at <> OLD.requested_at
    OR NEW.version <> OLD.version + 1
  THEN
    RAISE EXCEPTION 'invalid Rework transition, identity, or version';
  END IF;
  SELECT * INTO new_execution FROM manual_executions WHERE id = NEW.new_execution_id;
  IF new_execution.id IS NULL OR new_execution.id = NEW.previous_execution_id
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
--> statement-breakpoint
CREATE TRIGGER guard_rework_update
BEFORE UPDATE ON rework_requests
FOR EACH ROW EXECUTE FUNCTION helm_guard_rework_update();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION helm_validate_review_resolution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_review_id uuid;
  target_review reviews%ROWTYPE;
  target_gate human_gates%ROWTYPE;
  rework_count bigint;
BEGIN
  IF TG_TABLE_NAME = 'reviews' THEN target_review_id := NEW.id;
  ELSIF TG_TABLE_NAME = 'human_gates' THEN target_review_id := NEW.review_id;
  ELSE target_review_id := NEW.rejected_review_id;
  END IF;
  SELECT * INTO target_review FROM reviews WHERE id = target_review_id;
  SELECT * INTO target_gate FROM human_gates WHERE review_id = target_review_id;
  SELECT count(*) INTO rework_count FROM rework_requests WHERE rejected_review_id = target_review_id;
  IF target_review.id IS NULL OR target_gate.id IS NULL
    OR (target_review.status = 'pending' AND target_gate.status <> 'pending')
    OR (target_review.status = 'approved' AND target_gate.status <> 'passed')
    OR (target_review.status = 'rejected' AND target_gate.status <> 'rework_required')
    OR (target_review.status = 'rejected' AND rework_count <> 1)
    OR (target_review.status <> 'rejected' AND rework_count <> 0)
  THEN
    RAISE EXCEPTION 'Review %, Human gate, and Rework path disagree', target_review_id;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER validate_review_resolution_from_review
AFTER INSERT OR UPDATE ON reviews DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION helm_validate_review_resolution();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER validate_review_resolution_from_gate
AFTER INSERT OR UPDATE ON human_gates DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION helm_validate_review_resolution();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER validate_review_resolution_from_rework
AFTER INSERT OR UPDATE ON rework_requests DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION helm_validate_review_resolution();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION helm_prevent_review_fact_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Review, Human gate, and Rework facts are immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER prevent_review_delete BEFORE DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION helm_prevent_review_fact_delete();
--> statement-breakpoint
CREATE TRIGGER prevent_human_gate_delete BEFORE DELETE ON human_gates
FOR EACH ROW EXECUTE FUNCTION helm_prevent_review_fact_delete();
--> statement-breakpoint
CREATE TRIGGER prevent_rework_delete BEFORE DELETE ON rework_requests
FOR EACH ROW EXECUTE FUNCTION helm_prevent_review_fact_delete();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION helm_validate_manual_execution_start()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_status work_item_status;
  current_graph_version integer;
  configured_rework_id uuid;
BEGIN
  SELECT wi.status, wg.graph_version
  INTO current_status, current_graph_version
  FROM work_items wi
  JOIN graph_nodes gn ON gn.id = wi.graph_node_id
  JOIN work_graphs wg ON wg.id = gn.graph_id
  WHERE wi.id = NEW.work_item_id
  FOR UPDATE OF wi;
  IF NOT FOUND THEN RAISE EXCEPTION 'work item % does not exist', NEW.work_item_id; END IF;
  IF current_graph_version <> NEW.graph_version THEN
    RAISE EXCEPTION 'execution graph version % does not match current version %', NEW.graph_version, current_graph_version;
  END IF;
  IF current_status = 'ready' THEN RETURN NEW; END IF;
  BEGIN
    configured_rework_id := nullif(current_setting('helm.rework_request_id', true), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    configured_rework_id := NULL;
  END;
  IF current_status <> 'in_progress' OR configured_rework_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM rework_requests request
    WHERE request.id = configured_rework_id
      AND request.work_item_id = NEW.work_item_id
      AND request.graph_version = NEW.graph_version
      AND request.status = 'requested'
  ) THEN
    RAISE EXCEPTION 'work item % must be ready or own the configured requested Rework', NEW.work_item_id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION helm_check_review_gate_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_graph_version integer;
  latest_gate_status helm_human_gate_status;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  SELECT graph.graph_version INTO current_graph_version
  FROM graph_nodes node JOIN work_graphs graph ON graph.id = node.graph_id
  WHERE node.id = NEW.graph_node_id;
  IF NEW.status = 'completed' THEN
    SELECT gate.status INTO latest_gate_status
    FROM human_gates gate
    WHERE gate.work_item_id = NEW.id AND gate.graph_version = current_graph_version
    ORDER BY gate.opened_at DESC, gate.id DESC LIMIT 1;
    IF FOUND AND latest_gate_status <> 'passed' THEN
      RAISE EXCEPTION 'latest Human gate must pass before reviewed WorkItem % completes', NEW.id;
    END IF;
  END IF;
  IF NEW.status = 'ready' AND EXISTS (
    SELECT 1
    FROM work_edges edge
    JOIN work_items dependency ON dependency.graph_node_id = edge.source_node_id
    JOIN LATERAL (
      SELECT gate.status
      FROM human_gates gate
      WHERE gate.work_item_id = dependency.id AND gate.graph_version = current_graph_version
      ORDER BY gate.opened_at DESC, gate.id DESC LIMIT 1
    ) latest_gate ON true
    WHERE edge.target_node_id = NEW.graph_node_id
      AND edge.is_hard_dependency AND latest_gate.status <> 'passed'
  ) THEN
    RAISE EXCEPTION 'downstream WorkItem % is blocked by an unpassed Human gate', NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER trg_check_review_gate_transition
BEFORE UPDATE OF status ON work_items
FOR EACH ROW EXECUTE FUNCTION helm_check_review_gate_transition();
