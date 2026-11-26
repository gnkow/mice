CREATE TABLE IF NOT EXISTS "validated_branches" (
	"repository_id" uuid NOT NULL,
	"branch" text NOT NULL,
	"validated" boolean DEFAULT true NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"marked_by" text,
	"reason" text,
	"change_control_id" text,
	CONSTRAINT "validated_branches_repository_id_branch_pk" PRIMARY KEY("repository_id","branch")
);
--> statement-breakpoint
ALTER TABLE "validated_branches" ADD CONSTRAINT "validated_branches_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "validated_branches" ("repository_id", "branch", "validated", "marked_at")
SELECT "id", 'main', true, now() FROM "repositories"
ON CONFLICT DO NOTHING;
