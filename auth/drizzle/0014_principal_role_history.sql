CREATE TABLE "principal_role_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "principal_role_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"principal_id" bigint NOT NULL,
	"role" text NOT NULL,
	"action" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"granted_by" bigint,
	"revoked_at" timestamp with time zone,
	"revoked_by" bigint,
	"grant_reason" text,
	"revoke_reason" text,
	"access_request_id" text
);
--> statement-breakpoint
ALTER TABLE "principal_role_history" ADD CONSTRAINT "principal_role_history_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "principal_role_history" ADD CONSTRAINT "principal_role_history_granted_by_principals_id_fk" FOREIGN KEY ("granted_by") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "principal_role_history" ADD CONSTRAINT "principal_role_history_revoked_by_principals_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "principal_role_history_principal_idx" ON "principal_role_history" USING btree ("principal_id","granted_at");
