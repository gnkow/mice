CREATE TABLE IF NOT EXISTS "audit_visibility" (
	"id" text PRIMARY KEY NOT NULL,
	"hidden_actions" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
