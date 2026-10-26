CREATE TABLE "auth_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auth_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" text NOT NULL,
	"principal_key" text NOT NULL,
	"request_id" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_events_principal_idx" ON "auth_events" USING btree ("principal_key","timestamp");--> statement-breakpoint
CREATE INDEX "auth_events_timestamp_idx" ON "auth_events" USING btree ("timestamp");