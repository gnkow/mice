CREATE TABLE "audit_query_index" (
	"event_id" text PRIMARY KEY NOT NULL,
	"ledger_seq" bigint NOT NULL,
	"ts" text NOT NULL,
	"action" text NOT NULL,
	"actor_sub" text NOT NULL,
	"actor_email" text NOT NULL,
	"actor_name" text NOT NULL,
	"via" text NOT NULL,
	"namespace" text,
	"repo" text,
	"phase" text,
	"intent_id" text,
	"event" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_query_index_ts" ON "audit_query_index" USING btree ("ts");
--> statement-breakpoint
CREATE INDEX "audit_query_index_action" ON "audit_query_index" USING btree ("action");
--> statement-breakpoint
CREATE INDEX "audit_query_index_namespace" ON "audit_query_index" USING btree ("namespace");
--> statement-breakpoint
CREATE INDEX "audit_query_index_repo" ON "audit_query_index" USING btree ("repo");
--> statement-breakpoint
CREATE INDEX "audit_query_index_actor_sub" ON "audit_query_index" USING btree ("actor_sub");
--> statement-breakpoint
CREATE INDEX "audit_query_index_ledger_seq" ON "audit_query_index" USING btree ("ledger_seq");
--> statement-breakpoint
CREATE TABLE "audit_query_index_cursor" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"audit_seq" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"checked_at" timestamp with time zone,
	"detail" text,
	CONSTRAINT "audit_query_index_cursor_singleton" CHECK ("audit_query_index_cursor"."id" = 1)
);
