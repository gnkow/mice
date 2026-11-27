CREATE TABLE "commit_qc_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"commit_id" text NOT NULL,
	"status" text NOT NULL,
	"signature_id" text NOT NULL,
	"actor_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commit_qc_events" ADD CONSTRAINT "commit_qc_events_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "commit_qc_events_commit_idx" ON "commit_qc_events" USING btree ("repository_id","commit_id","created_at");
