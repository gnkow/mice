CREATE TABLE "namespace_membership_versions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "namespace_membership_versions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"namespace_id" uuid NOT NULL,
	"members" jsonb NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "namespace_membership_versions" ADD CONSTRAINT "namespace_membership_versions_namespace_id_namespaces_id_fk" FOREIGN KEY ("namespace_id") REFERENCES "namespaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "namespace_membership_versions_ns_from_idx" ON "namespace_membership_versions" USING btree ("namespace_id","valid_from");
