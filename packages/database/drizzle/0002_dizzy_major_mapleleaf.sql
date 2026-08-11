CREATE TYPE "public"."requirement_status" AS ENUM('planned', 'in_progress', 'blocked', 'completed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."work_item_status" AS ENUM('pending', 'ready', 'in_progress', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TABLE "graph_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"graph_id" uuid NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"graph_id" uuid NOT NULL,
	"source_node_id" uuid NOT NULL,
	"target_node_id" uuid NOT NULL,
	"is_hard_dependency" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_graphs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requirement_id" uuid NOT NULL,
	"graph_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_graphs_requirement_id_unique" UNIQUE("requirement_id")
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"graph_node_id" uuid NOT NULL,
	"status" "work_item_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_items_graph_node_id_unique" UNIQUE("graph_node_id")
);
--> statement-breakpoint
ALTER TABLE "requirements" ADD COLUMN "status" "requirement_status" DEFAULT 'planned' NOT NULL;--> statement-breakpoint
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_graph_id_work_graphs_id_fk" FOREIGN KEY ("graph_id") REFERENCES "public"."work_graphs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_edges" ADD CONSTRAINT "work_edges_graph_id_work_graphs_id_fk" FOREIGN KEY ("graph_id") REFERENCES "public"."work_graphs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_edges" ADD CONSTRAINT "work_edges_source_node_id_graph_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_edges" ADD CONSTRAINT "work_edges_target_node_id_graph_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_graphs" ADD CONSTRAINT "work_graphs_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_graph_node_id_graph_nodes_id_fk" FOREIGN KEY ("graph_node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "graph_node_graph_key_unique" ON "graph_nodes" USING btree ("graph_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "work_edge_unique" ON "work_edges" USING btree ("graph_id","source_node_id","target_node_id");

--> statement-breakpoint
ALTER TABLE "work_graphs" ADD CONSTRAINT "work_graphs_version_positive" CHECK ("graph_version" > 0);
--> statement-breakpoint
ALTER TABLE "work_edges" ADD CONSTRAINT "work_edges_no_self_reference" CHECK ("source_node_id" <> "target_node_id");

--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."check_work_edge_graph"()
RETURNS trigger AS $$
DECLARE
  source_graph uuid;
  target_graph uuid;
BEGIN
  SELECT "graph_id" INTO source_graph FROM "public"."graph_nodes" WHERE "id" = NEW."source_node_id";
  SELECT "graph_id" INTO target_graph FROM "public"."graph_nodes" WHERE "id" = NEW."target_node_id";
  IF source_graph IS DISTINCT FROM NEW."graph_id" OR target_graph IS DISTINCT FROM NEW."graph_id" THEN
    RAISE EXCEPTION 'work edge nodes must belong to the same graph as the edge';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "trg_check_work_edge_graph"
  BEFORE INSERT OR UPDATE ON "public"."work_edges"
  FOR EACH ROW EXECUTE FUNCTION "public"."check_work_edge_graph"();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."guard_requirement_status"()
RETURNS trigger AS $$
BEGIN
  IF NEW."status" IS DISTINCT FROM OLD."status" AND pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'requirement status is derived from required work items and cannot be updated directly';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "trg_guard_requirement_status"
  BEFORE UPDATE ON "public"."requirements"
  FOR EACH ROW EXECUTE FUNCTION "public"."guard_requirement_status"();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."check_work_item_transition"()
RETURNS trigger AS $$
BEGIN
  IF NEW."status" = OLD."status" THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD."status" = 'pending' AND NEW."status" IN ('ready', 'canceled')) OR
    (OLD."status" = 'ready' AND NEW."status" IN ('in_progress', 'canceled')) OR
    (OLD."status" = 'in_progress' AND NEW."status" IN ('completed', 'failed', 'canceled')) OR
    (OLD."status" = 'failed' AND NEW."status" IN ('ready', 'canceled'))
  ) THEN
    RAISE EXCEPTION 'illegal work item transition from % to %', OLD."status", NEW."status";
  END IF;

  IF NEW."status" = 'ready' AND EXISTS (
    SELECT 1
    FROM "public"."work_edges" edge
    LEFT JOIN "public"."work_items" dependency
      ON dependency."graph_node_id" = edge."source_node_id"
    WHERE edge."target_node_id" = NEW."graph_node_id"
      AND edge."is_hard_dependency"
      AND (dependency."id" IS NULL OR dependency."status" <> 'completed')
  ) THEN
    RAISE EXCEPTION 'hard dependencies must be completed before work item becomes ready';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "trg_check_work_item_transition"
  BEFORE UPDATE OF "status" ON "public"."work_items"
  FOR EACH ROW EXECUTE FUNCTION "public"."check_work_item_transition"();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."advance_work_graph"()
RETURNS trigger AS $$
DECLARE
  target_requirement_id uuid;
  derived_status "public"."requirement_status";
BEGIN
  IF NEW."status" = 'completed' AND OLD."status" IS DISTINCT FROM NEW."status" THEN
    UPDATE "public"."work_items" candidate
    SET "status" = 'ready', "updated_at" = now()
    FROM "public"."work_edges" downstream
    WHERE downstream."source_node_id" = NEW."graph_node_id"
      AND downstream."is_hard_dependency"
      AND candidate."graph_node_id" = downstream."target_node_id"
      AND candidate."status" = 'pending'
      AND NOT EXISTS (
        SELECT 1
        FROM "public"."work_edges" dependency_edge
        LEFT JOIN "public"."work_items" dependency
          ON dependency."graph_node_id" = dependency_edge."source_node_id"
        WHERE dependency_edge."target_node_id" = downstream."target_node_id"
          AND dependency_edge."is_hard_dependency"
          AND (dependency."id" IS NULL OR dependency."status" <> 'completed')
      );
  END IF;

  SELECT graph."requirement_id"
  INTO target_requirement_id
  FROM "public"."graph_nodes" node
  JOIN "public"."work_graphs" graph ON graph."id" = node."graph_id"
  WHERE node."id" = NEW."graph_node_id";

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

  UPDATE "public"."requirements"
  SET "status" = derived_status, "updated_at" = now()
  WHERE "id" = target_requirement_id AND "status" IS DISTINCT FROM derived_status;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "trg_advance_work_graph"
  AFTER UPDATE OF "status" ON "public"."work_items"
  FOR EACH ROW EXECUTE FUNCTION "public"."advance_work_graph"();
