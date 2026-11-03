CREATE TABLE IF NOT EXISTS "group_binding_status" (
	"id" text PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"message" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL
);
