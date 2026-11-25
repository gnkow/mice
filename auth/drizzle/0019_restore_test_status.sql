CREATE TABLE IF NOT EXISTS "restore_test_status" (
	"id" text PRIMARY KEY NOT NULL,
	"passed" boolean NOT NULL,
	"passed_at" timestamp with time zone,
	"recorded_by" text
);
