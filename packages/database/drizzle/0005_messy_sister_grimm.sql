CREATE TYPE "public"."helm_bug_discovery_stage" AS ENUM('requirement', 'design', 'implementation', 'review', 'qa', 'release', 'production');--> statement-breakpoint
CREATE TYPE "public"."helm_bug_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."helm_bug_status" AS ENUM('open', 'fix_in_progress', 'awaiting_qa', 'closed');--> statement-breakpoint
CREATE TYPE "public"."helm_qa_regression_status" AS ENUM('pending', 'passed', 'failed');--> statement-breakpoint
CREATE TABLE "bug_fix_edges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bug_id" uuid NOT NULL,
	"execution_id" uuid NOT NULL,
	"result_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"passed_gate_id" uuid NOT NULL,
	"fixed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bug_fix_edges_execution_unique" UNIQUE("execution_id"),
	CONSTRAINT "bug_fix_edges_result_unique" UNIQUE("result_id"),
	CONSTRAINT "bug_fix_edges_review_unique" UNIQUE("review_id"),
	CONSTRAINT "bug_fix_edges_gate_unique" UNIQUE("passed_gate_id")
);
--> statement-breakpoint
CREATE TABLE "bug_work_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_requirement_id" uuid NOT NULL,
	"graph_version" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"discovered_in" "helm_bug_discovery_stage" NOT NULL,
	"severity" "helm_bug_severity" NOT NULL,
	"blocking" boolean NOT NULL,
	"reporter_member_id" uuid NOT NULL,
	"status" "helm_bug_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "bug_work_items_graph_version_positive" CHECK ("bug_work_items"."graph_version" > 0),
	CONSTRAINT "bug_work_items_title_non_blank" CHECK (length(btrim("bug_work_items"."title")) > 0),
	CONSTRAINT "bug_work_items_description_non_blank" CHECK (length(btrim("bug_work_items"."description")) > 0),
	CONSTRAINT "bug_work_items_version_positive" CHECK ("bug_work_items"."version" > 0),
	CONSTRAINT "bug_work_items_close_check" CHECK ((
        ("bug_work_items"."status" = 'closed' AND "bug_work_items"."blocking" = false AND "bug_work_items"."closed_at" IS NOT NULL)
        OR ("bug_work_items"."status" <> 'closed' AND "bug_work_items"."closed_at" IS NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "qa_regression_edges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bug_id" uuid NOT NULL,
	"fix_edge_id" uuid NOT NULL,
	"qa_member_id" uuid NOT NULL,
	"status" "helm_qa_regression_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "qa_regression_edges_fix_unique" UNIQUE("fix_edge_id"),
	CONSTRAINT "qa_regression_edges_version_positive" CHECK ("qa_regression_edges"."version" > 0),
	CONSTRAINT "qa_regression_edges_completion_check" CHECK ((
        ("qa_regression_edges"."status" = 'pending' AND "qa_regression_edges"."completed_at" IS NULL)
        OR ("qa_regression_edges"."status" IN ('passed', 'failed') AND "qa_regression_edges"."completed_at" IS NOT NULL)
      ))
);
--> statement-breakpoint
ALTER TABLE "bug_fix_edges" ADD CONSTRAINT "bug_fix_edges_bug_id_bug_work_items_id_fk" FOREIGN KEY ("bug_id") REFERENCES "public"."bug_work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_fix_edges" ADD CONSTRAINT "bug_fix_edges_execution_id_manual_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."manual_executions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_fix_edges" ADD CONSTRAINT "bug_fix_edges_result_id_execution_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."execution_results"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_fix_edges" ADD CONSTRAINT "bug_fix_edges_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_fix_edges" ADD CONSTRAINT "bug_fix_edges_passed_gate_id_human_gates_id_fk" FOREIGN KEY ("passed_gate_id") REFERENCES "public"."human_gates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_work_items" ADD CONSTRAINT "bug_work_items_source_requirement_id_requirements_id_fk" FOREIGN KEY ("source_requirement_id") REFERENCES "public"."requirements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bug_work_items" ADD CONSTRAINT "bug_work_items_reporter_member_id_members_id_fk" FOREIGN KEY ("reporter_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_regression_edges" ADD CONSTRAINT "qa_regression_edges_bug_id_bug_work_items_id_fk" FOREIGN KEY ("bug_id") REFERENCES "public"."bug_work_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_regression_edges" ADD CONSTRAINT "qa_regression_edges_fix_edge_id_bug_fix_edges_id_fk" FOREIGN KEY ("fix_edge_id") REFERENCES "public"."bug_fix_edges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_regression_edges" ADD CONSTRAINT "qa_regression_edges_qa_member_id_members_id_fk" FOREIGN KEY ("qa_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bug_work_items_requirement_idx" ON "bug_work_items" USING btree ("source_requirement_id","status","blocking");--> statement-breakpoint
CREATE INDEX "qa_regression_edges_bug_idx" ON "qa_regression_edges" USING btree ("bug_id","requested_at");--> statement-breakpoint

CREATE FUNCTION "public"."protect_bug_identity"() RETURNS trigger AS $$
BEGIN
  IF (NEW."id", NEW."source_requirement_id", NEW."graph_version", NEW."title",
      NEW."description", NEW."discovered_in", NEW."severity",
      NEW."reporter_member_id", NEW."created_at")
     IS DISTINCT FROM
     (OLD."id", OLD."source_requirement_id", OLD."graph_version", OLD."title",
      OLD."description", OLD."discovered_in", OLD."severity",
      OLD."reporter_member_id", OLD."created_at") THEN
    RAISE EXCEPTION 'Bug identity and source fields are immutable';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'Bug version must increment exactly once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "trg_protect_bug_identity"
  BEFORE UPDATE ON "public"."bug_work_items"
  FOR EACH ROW EXECUTE FUNCTION "public"."protect_bug_identity"();--> statement-breakpoint

CREATE FUNCTION "public"."reject_bug_edge_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "trg_bug_fix_edges_immutable"
  BEFORE UPDATE OR DELETE ON "public"."bug_fix_edges"
  FOR EACH ROW EXECUTE FUNCTION "public"."reject_bug_edge_mutation"();--> statement-breakpoint
CREATE TRIGGER "trg_qa_regression_edges_no_delete"
  BEFORE DELETE ON "public"."qa_regression_edges"
  FOR EACH ROW EXECUTE FUNCTION "public"."reject_bug_edge_mutation"();--> statement-breakpoint

CREATE FUNCTION "public"."protect_qa_regression"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'pending' OR NEW."status" NOT IN ('passed', 'failed') THEN
    RAISE EXCEPTION 'QA regression may transition only once from pending';
  END IF;
  IF (NEW."id", NEW."bug_id", NEW."fix_edge_id", NEW."qa_member_id", NEW."requested_at")
     IS DISTINCT FROM
     (OLD."id", OLD."bug_id", OLD."fix_edge_id", OLD."qa_member_id", OLD."requested_at") THEN
    RAISE EXCEPTION 'QA regression identity is immutable';
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'QA regression version must increment exactly once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "trg_protect_qa_regression"
  BEFORE UPDATE ON "public"."qa_regression_edges"
  FOR EACH ROW EXECUTE FUNCTION "public"."protect_qa_regression"();--> statement-breakpoint

CREATE FUNCTION "public"."validate_bug_fix_review_chain"() RETURNS trigger AS $$
DECLARE
  target_bug "public"."bug_work_items"%ROWTYPE;
BEGIN
  SELECT * INTO target_bug FROM "public"."bug_work_items" WHERE "id" = NEW."bug_id";
  IF NOT EXISTS (
    SELECT 1
    FROM "public"."manual_executions" execution
    JOIN "public"."execution_results" result
      ON result."id" = NEW."result_id" AND result."execution_id" = execution."id"
    JOIN "public"."reviews" review
      ON review."id" = NEW."review_id"
      AND review."result_id" = result."id"
      AND review."execution_id" = execution."id"
    JOIN "public"."human_gates" gate
      ON gate."id" = NEW."passed_gate_id"
      AND gate."review_id" = review."id"
      AND gate."work_item_id" = execution."work_item_id"
      AND gate."graph_version" = execution."graph_version"
      AND gate."status" = 'passed'
    JOIN "public"."work_items" item ON item."id" = execution."work_item_id"
    JOIN "public"."graph_nodes" node ON node."id" = item."graph_node_id"
    JOIN "public"."work_graphs" graph ON graph."id" = node."graph_id"
    WHERE execution."id" = NEW."execution_id"
      AND execution."graph_version" = target_bug."graph_version"
      AND graph."requirement_id" = target_bug."source_requirement_id"
  ) THEN
    RAISE EXCEPTION 'Bug fix must reference one passed Review gate chain in the source Requirement graph';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "trg_validate_bug_fix_review_chain"
  AFTER INSERT ON "public"."bug_fix_edges"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "public"."validate_bug_fix_review_chain"();--> statement-breakpoint

CREATE FUNCTION "public"."validate_bug_qa_consistency"() RETURNS trigger AS $$
DECLARE
  target_bug_id uuid;
  current_bug "public"."bug_work_items"%ROWTYPE;
  latest_regression "public"."qa_regression_edges"%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'bug_work_items' THEN
    target_bug_id := COALESCE(NEW."id", OLD."id");
  ELSE
    target_bug_id := COALESCE(NEW."bug_id", OLD."bug_id");
  END IF;
  SELECT * INTO current_bug FROM "public"."bug_work_items" WHERE "id" = target_bug_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF EXISTS (
    SELECT 1 FROM "public"."bug_fix_edges" fix
    WHERE fix."bug_id" = target_bug_id
      AND NOT EXISTS (
        SELECT 1 FROM "public"."qa_regression_edges" regression
        WHERE regression."fix_edge_id" = fix."id" AND regression."bug_id" = fix."bug_id"
      )
  ) THEN
    RAISE EXCEPTION 'Every Bug fix edge requires a matching QA regression edge';
  END IF;

  SELECT * INTO latest_regression
  FROM "public"."qa_regression_edges"
  WHERE "bug_id" = target_bug_id
  ORDER BY "requested_at" DESC, "id" DESC
  LIMIT 1;
  IF FOUND THEN
    IF latest_regression."status" = 'pending' AND current_bug."status" <> 'awaiting_qa' THEN
      RAISE EXCEPTION 'A pending QA regression requires an awaiting_qa Bug';
    ELSIF latest_regression."status" = 'passed'
       AND (current_bug."status" <> 'closed' OR current_bug."blocking") THEN
      RAISE EXCEPTION 'A passed QA regression must close and unblock its Bug';
    ELSIF latest_regression."status" = 'failed' AND current_bug."status" <> 'open' THEN
      RAISE EXCEPTION 'A failed QA regression must return its Bug to open';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "trg_bug_work_items_consistent_with_qa"
  AFTER INSERT OR UPDATE ON "public"."bug_work_items"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "public"."validate_bug_qa_consistency"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "trg_bug_fix_edges_consistent_with_qa"
  AFTER INSERT ON "public"."bug_fix_edges"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "public"."validate_bug_qa_consistency"();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "trg_qa_regression_edges_consistent_with_bug"
  AFTER INSERT OR UPDATE ON "public"."qa_regression_edges"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "public"."validate_bug_qa_consistency"();--> statement-breakpoint

CREATE FUNCTION "public"."sync_requirement_bug_block"() RETURNS trigger AS $$
DECLARE
  target_requirement_id uuid := COALESCE(NEW."source_requirement_id", OLD."source_requirement_id");
  derived_status "public"."requirement_status";
BEGIN
  IF EXISTS (
    SELECT 1 FROM "public"."bug_work_items"
    WHERE "source_requirement_id" = target_requirement_id
      AND "blocking" AND "status" <> 'closed'
  ) THEN
    derived_status := 'blocked';
  ELSE
    SELECT CASE
      WHEN count(*) FILTER (WHERE node."is_required") = 0 THEN 'planned'
      WHEN bool_and(item."status" = 'completed') FILTER (WHERE node."is_required") THEN 'completed'
      WHEN bool_and(item."status" = 'canceled') FILTER (WHERE node."is_required") THEN 'canceled'
      WHEN bool_or(item."status" = 'failed') FILTER (WHERE node."is_required") THEN 'blocked'
      WHEN bool_or(item."status" IN ('in_progress', 'completed')) FILTER (WHERE node."is_required") THEN 'in_progress'
      ELSE 'planned'
    END::"public"."requirement_status"
    INTO derived_status
    FROM "public"."work_graphs" graph
    JOIN "public"."graph_nodes" node ON node."graph_id" = graph."id"
    JOIN "public"."work_items" item ON item."graph_node_id" = node."id"
    WHERE graph."requirement_id" = target_requirement_id;
    derived_status := COALESCE(derived_status, 'planned');
  END IF;

  UPDATE "public"."requirements"
  SET "status" = derived_status, "updated_at" = now()
  WHERE "id" = target_requirement_id AND "status" IS DISTINCT FROM derived_status;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "trg_sync_requirement_bug_block"
  AFTER INSERT OR UPDATE OF "status", "blocking" ON "public"."bug_work_items"
  FOR EACH ROW EXECUTE FUNCTION "public"."sync_requirement_bug_block"();--> statement-breakpoint

CREATE FUNCTION "public"."enforce_requirement_bug_block"() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'completed' AND EXISTS (
    SELECT 1 FROM "public"."bug_work_items"
    WHERE "source_requirement_id" = NEW."id"
      AND "blocking" AND "status" <> 'closed'
  ) THEN
    UPDATE "public"."requirements"
    SET "status" = 'blocked', "updated_at" = now()
    WHERE "id" = NEW."id";
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "trg_enforce_requirement_bug_block"
  AFTER UPDATE OF "status" ON "public"."requirements"
  FOR EACH ROW EXECUTE FUNCTION "public"."enforce_requirement_bug_block"();
