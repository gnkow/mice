DROP TABLE IF EXISTS "repo_group_collaborators" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "repo_collaborators" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "custom_repo_roles" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "custom_namespace_roles" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "namespace_group_members" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "namespace_members" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "jobs" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "repository_tombstones" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "repositories" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "namespace_tombstones" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "namespaces" CASCADE;--> statement-breakpoint
CREATE TABLE "namespaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"base_permission" text NOT NULL,
	"members_can_create_repos" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "namespaces_name" ON "namespaces" USING btree ("name");--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"namespace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "namespaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_namespace_name" ON "repositories" USING btree ("namespace_id","name");--> statement-breakpoint
CREATE TABLE "namespace_members" (
	"namespace_id" uuid NOT NULL,
	"user_key" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "namespace_members_namespace_id_user_key_pk" PRIMARY KEY("namespace_id","user_key")
);--> statement-breakpoint
ALTER TABLE "namespace_members" ADD CONSTRAINT "namespace_members_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "namespaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "namespace_members_user" ON "namespace_members" USING btree ("user_key");--> statement-breakpoint
CREATE TABLE "namespace_group_members" (
	"namespace_id" uuid NOT NULL,
	"group_key" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "namespace_group_members_namespace_id_group_key_pk" PRIMARY KEY("namespace_id","group_key")
);--> statement-breakpoint
ALTER TABLE "namespace_group_members" ADD CONSTRAINT "namespace_group_members_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "namespaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "namespace_group_members_group" ON "namespace_group_members" USING btree ("group_key");--> statement-breakpoint
CREATE TABLE "repo_collaborators" (
	"repository_id" uuid NOT NULL,
	"user_key" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "repo_collaborators_repository_id_user_key_pk" PRIMARY KEY("repository_id","user_key")
);--> statement-breakpoint
ALTER TABLE "repo_collaborators" ADD CONSTRAINT "repo_collaborators_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repo_collaborators_user" ON "repo_collaborators" USING btree ("user_key");--> statement-breakpoint
CREATE TABLE "repo_group_collaborators" (
	"repository_id" uuid NOT NULL,
	"group_key" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "repo_group_collaborators_repository_id_group_key_pk" PRIMARY KEY("repository_id","group_key")
);--> statement-breakpoint
ALTER TABLE "repo_group_collaborators" ADD CONSTRAINT "repo_group_collaborators_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repo_group_collaborators_group" ON "repo_group_collaborators" USING btree ("group_key");--> statement-breakpoint
CREATE TABLE "custom_namespace_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb NOT NULL,
	"base_repository_role" text
);--> statement-breakpoint
ALTER TABLE "custom_namespace_roles" ADD CONSTRAINT "custom_namespace_roles_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "namespaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_namespace_roles_name" ON "custom_namespace_roles" USING btree ("namespace_id",lower("name"));--> statement-breakpoint
CREATE TABLE "custom_repo_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base" text NOT NULL,
	"permissions" jsonb NOT NULL
);--> statement-breakpoint
ALTER TABLE "custom_repo_roles" ADD CONSTRAINT "custom_repo_roles_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "namespaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_repo_roles_name" ON "custom_repo_roles" USING btree ("namespace_id",lower("name"));--> statement-breakpoint
CREATE TABLE "namespace_tombstones" (
	"name" text PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE TABLE "repository_tombstones" (
	"namespace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "repository_tombstones_namespace_id_name_pk" PRIMARY KEY("namespace_id","name")
);--> statement-breakpoint
ALTER TABLE "repository_tombstones" ADD CONSTRAINT "repository_tombstones_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "namespaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" uuid NOT NULL,
	"status" text NOT NULL,
	"pin_commit" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"body" jsonb NOT NULL
);--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_repo_created" ON "jobs" USING btree ("repository_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_status_created" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "jobs_pin_commit" ON "jobs" USING btree ("pin_commit");
