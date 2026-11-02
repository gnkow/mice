CREATE TABLE "access_review_reports" (
	"quarter" text PRIMARY KEY NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
