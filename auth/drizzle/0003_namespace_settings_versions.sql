ALTER TABLE "namespaces" ADD COLUMN "description" text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE TABLE "namespace_settings_versions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "namespace_settings_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"namespace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"base_permission" text NOT NULL,
	"members_can_create_repos" boolean NOT NULL,
	"change_control_id_pattern" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "namespace_settings_versions" ADD CONSTRAINT "namespace_settings_versions_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "namespaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "namespace_settings_versions_ns_from_idx" ON "namespace_settings_versions" USING btree ("namespace_id","valid_from");
