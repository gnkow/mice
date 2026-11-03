CREATE TABLE "principal_permissions" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "principal_permissions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"principal_id" bigint NOT NULL,
	"permission" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"granted_by" bigint,
	"grant_reason" text,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "principal_permissions" ADD CONSTRAINT "principal_permissions_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "principal_permissions" ADD CONSTRAINT "principal_permissions_granted_by_principals_id_fk" FOREIGN KEY ("granted_by") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "principal_permissions_principal_perm" ON "principal_permissions" USING btree ("principal_id","permission");
