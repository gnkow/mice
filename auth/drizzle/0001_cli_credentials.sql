CREATE TABLE "cli_credential_families" (
	"id" text PRIMARY KEY NOT NULL,
	"iss" text NOT NULL,
	"sub" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"scopes" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cli_credential_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"kind" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cli_credential_tokens" ADD CONSTRAINT "cli_credential_tokens_family_id_cli_credential_families_id_fk" FOREIGN KEY ("family_id") REFERENCES "cli_credential_families"("id") ON DELETE no action ON UPDATE no action;
