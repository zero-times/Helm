CREATE TYPE "public"."member_type" AS ENUM('human', 'agent', 'service');--> statement-breakpoint
CREATE TYPE "public"."role_type" AS ENUM('owner', 'admin', 'member', 'viewer');--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_type" "member_type" NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"accountable_human_id" uuid NOT NULL,
	"operational_owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"goal" text NOT NULL,
	"acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accountable_human_id" uuid NOT NULL,
	"operational_owner_id" uuid NOT NULL,
	"assignee_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"role" "role_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_accountable_human_id_members_id_fk" FOREIGN KEY ("accountable_human_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_operational_owner_id_members_id_fk" FOREIGN KEY ("operational_owner_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_accountable_human_id_members_id_fk" FOREIGN KEY ("accountable_human_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_operational_owner_id_members_id_fk" FOREIGN KEY ("operational_owner_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_assignee_member_id_members_id_fk" FOREIGN KEY ("assignee_member_id") REFERENCES "public"."members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_org_slug_unique" ON "projects" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "ra_member_org_role_unique" ON "role_assignments" USING btree ("member_id","organization_id","role");

-- ─── Database-level invariant enforcement (triggers for cross-table checks) ────

-- Trigger function: validate project accountability invariants
CREATE OR REPLACE FUNCTION "public"."check_project_accountability"()
RETURNS trigger AS $$
DECLARE
  accountable_type "public"."member_type";
  accountable_org uuid;
  owner_org uuid;
BEGIN
  SELECT "member_type", "organization_id"
    INTO accountable_type, accountable_org
    FROM "public"."members"
    WHERE "id" = NEW."accountable_human_id";

  IF accountable_type IS NULL THEN
    RAISE EXCEPTION 'accountable_human_id does not reference a valid member';
  END IF;

  IF accountable_type != 'human' THEN
    RAISE EXCEPTION 'accountable_human_id must reference a Human member (type=human), got %',
      accountable_type;
  END IF;

  IF accountable_org != NEW."organization_id" THEN
    RAISE EXCEPTION 'accountable_human_id must belong to the same organization as the project';
  END IF;

  SELECT "organization_id"
    INTO owner_org
    FROM "public"."members"
    WHERE "id" = NEW."operational_owner_id";

  IF owner_org IS NULL THEN
    RAISE EXCEPTION 'operational_owner_id does not reference a valid member';
  END IF;

  IF owner_org != NEW."organization_id" THEN
    RAISE EXCEPTION 'operational_owner_id must belong to the same organization as the project';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_check_project_accountability"
  BEFORE INSERT OR UPDATE ON "public"."projects"
  FOR EACH ROW EXECUTE FUNCTION "public"."check_project_accountability"();

-- Trigger function: validate requirement invariants (accountability + cross-org + non-blank goal + acceptance criteria)
CREATE OR REPLACE FUNCTION "public"."check_requirement_invariants"()
RETURNS trigger AS $$
DECLARE
  project_org uuid;
  accountable_type "public"."member_type";
  accountable_org uuid;
  owner_org uuid;
  assignee_org uuid;
BEGIN
  -- Get parent project's organization
  SELECT "organization_id"
    INTO project_org
    FROM "public"."projects"
    WHERE "id" = NEW."project_id";

  IF project_org IS NULL THEN
    RAISE EXCEPTION 'project_id does not reference a valid project';
  END IF;

  -- Validate goal is non-blank
  IF NEW."goal" IS NULL OR btrim(NEW."goal") = '' THEN
    RAISE EXCEPTION 'requirement goal must not be blank';
  END IF;

  -- Validate acceptance_criteria is a non-empty JSON array of non-blank strings
  IF NEW."acceptance_criteria" IS NULL
    OR jsonb_typeof(NEW."acceptance_criteria") != 'array'
    OR jsonb_array_length(NEW."acceptance_criteria") = 0 THEN
    RAISE EXCEPTION 'acceptance_criteria must be a non-empty JSON array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW."acceptance_criteria") AS criterion(value)
    WHERE jsonb_typeof(criterion.value) != 'string'
      OR btrim(criterion.value #>> '{}') = ''
  ) THEN
    RAISE EXCEPTION 'acceptance_criteria entries must be non-blank strings';
  END IF;

  -- Validate accountable human is Human and same org
  SELECT "member_type", "organization_id"
    INTO accountable_type, accountable_org
    FROM "public"."members"
    WHERE "id" = NEW."accountable_human_id";

  IF accountable_type IS NULL THEN
    RAISE EXCEPTION 'accountable_human_id does not reference a valid member';
  END IF;

  IF accountable_type != 'human' THEN
    RAISE EXCEPTION 'accountable_human_id must reference a Human member (type=human), got %',
      accountable_type;
  END IF;

  IF accountable_org != project_org THEN
    RAISE EXCEPTION 'accountable_human_id must belong to the same organization as the parent project';
  END IF;

  -- Validate operational owner is same org
  SELECT "organization_id"
    INTO owner_org
    FROM "public"."members"
    WHERE "id" = NEW."operational_owner_id";

  IF owner_org IS NULL THEN
    RAISE EXCEPTION 'operational_owner_id does not reference a valid member';
  END IF;

  IF owner_org != project_org THEN
    RAISE EXCEPTION 'operational_owner_id must belong to the same organization as the parent project';
  END IF;

  -- Validate assignee is same org
  SELECT "organization_id"
    INTO assignee_org
    FROM "public"."members"
    WHERE "id" = NEW."assignee_member_id";

  IF assignee_org IS NULL THEN
    RAISE EXCEPTION 'assignee_member_id does not reference a valid member';
  END IF;

  IF assignee_org != project_org THEN
    RAISE EXCEPTION 'assignee_member_id must belong to the same organization as the parent project';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_check_requirement_invariants"
  BEFORE INSERT OR UPDATE ON "public"."requirements"
  FOR EACH ROW EXECUTE FUNCTION "public"."check_requirement_invariants"();

-- Trigger function: validate role assignment member is in the same organization
CREATE OR REPLACE FUNCTION "public"."check_role_assignment_member_org"()
RETURNS trigger AS $$
DECLARE
  member_org uuid;
BEGIN
  SELECT "organization_id"
    INTO member_org
    FROM "public"."members"
    WHERE "id" = NEW."member_id";

  IF member_org IS NULL THEN
    RAISE EXCEPTION 'member_id does not reference a valid member';
  END IF;

  IF member_org != NEW."organization_id" THEN
    RAISE EXCEPTION 'member must belong to the assignment organization';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_check_role_assignment_member_org"
  BEFORE INSERT OR UPDATE ON "public"."role_assignments"
  FOR EACH ROW EXECUTE FUNCTION "public"."check_role_assignment_member_org"();
