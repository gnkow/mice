CREATE TABLE "permission_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "permission_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"principal_id" bigint NOT NULL,
	"snapshot_at" timestamp with time zone NOT NULL,
	"role" text,
	"custom_permissions" text[] NOT NULL,
	"effective_permissions" text[] NOT NULL,
	"snapshot_reason" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "permission_snapshots" ADD CONSTRAINT "permission_snapshots_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "permission_snapshots_principal_idx" ON "permission_snapshots" USING btree ("principal_id","snapshot_at");
