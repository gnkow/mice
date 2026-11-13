CREATE TABLE "custom_role_versions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "custom_role_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"namespace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"role_id" text NOT NULL,
	"definition" jsonb NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_role_versions" ADD CONSTRAINT "custom_role_versions_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "namespaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "custom_role_versions_ns_from_idx" ON "custom_role_versions" USING btree ("namespace_id","valid_from");
--> statement-breakpoint
CREATE INDEX "custom_role_versions_role_idx" ON "custom_role_versions" USING btree ("namespace_id","kind","role_id");
