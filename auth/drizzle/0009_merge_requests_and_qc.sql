CREATE TABLE "merge_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"namespace" text NOT NULL,
	"repo" text NOT NULL,
	"source_branch" text NOT NULL,
	"target_branch" text NOT NULL,
	"expected_source_head" text NOT NULL,
	"expected_target_head" text NOT NULL,
	"status" text NOT NULL,
	"opened_by" text NOT NULL,
	"merge_commit_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merge_requests" ADD CONSTRAINT "merge_requests_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "merge_requests_repo_status_idx" ON "merge_requests" USING btree ("repository_id","status");
--> statement-breakpoint
CREATE INDEX "merge_requests_repo_created_idx" ON "merge_requests" USING btree ("repository_id","created_at");
--> statement-breakpoint
CREATE TABLE "commit_qc_status" (
	"repository_id" uuid NOT NULL,
	"commit_id" text NOT NULL,
	"status" text NOT NULL,
	"merge_request_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commit_qc_status_repository_id_commit_id_pk" PRIMARY KEY("repository_id","commit_id")
);
--> statement-breakpoint
ALTER TABLE "commit_qc_status" ADD CONSTRAINT "commit_qc_status_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commit_qc_status" ADD CONSTRAINT "commit_qc_status_merge_request_id_merge_requests_id_fk" FOREIGN KEY ("merge_request_id") REFERENCES "merge_requests"("id") ON DELETE set null ON UPDATE no action;
