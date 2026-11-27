CREATE TABLE "repository_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"source_namespace_id" uuid NOT NULL,
	"target_namespace_id" uuid NOT NULL,
	"proposed_by" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text
);
--> statement-breakpoint
ALTER TABLE "repository_transfers" ADD CONSTRAINT "repository_transfers_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "repository_transfers" ADD CONSTRAINT "repository_transfers_source_namespace_id_namespaces_id_fk" FOREIGN KEY ("source_namespace_id") REFERENCES "namespaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "repository_transfers" ADD CONSTRAINT "repository_transfers_target_namespace_id_namespaces_id_fk" FOREIGN KEY ("target_namespace_id") REFERENCES "namespaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "repository_transfers_one_pending" ON "repository_transfers" USING btree ("repository_id") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX "repository_transfers_target_pending_idx" ON "repository_transfers" USING btree ("target_namespace_id") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX "repository_transfers_repo_idx" ON "repository_transfers" USING btree ("repository_id");
