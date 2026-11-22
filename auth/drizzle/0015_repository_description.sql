ALTER TABLE "repositories" ADD COLUMN "description" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "repository_settings_versions" ADD COLUMN "description" text DEFAULT '' NOT NULL;
