CREATE TABLE "principal_roles" (
	"principal_id" bigint PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"granted_by" bigint,
	"grant_reason" text,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "principal_roles" ADD CONSTRAINT "principal_roles_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "principal_roles" ADD CONSTRAINT "principal_roles_granted_by_principals_id_fk" FOREIGN KEY ("granted_by") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;
