CREATE TABLE "repo_collaborator_versions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "repo_collaborator_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"repository_id" uuid NOT NULL,
	"collaborators" jsonb NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repo_collaborator_versions" ADD CONSTRAINT "repo_collaborator_versions_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "repo_collaborator_versions_repo_from_idx" ON "repo_collaborator_versions" USING btree ("repository_id","valid_from");
