CREATE TABLE IF NOT EXISTS "commit_attributions" (
  "commit_id" text PRIMARY KEY NOT NULL,
  "author" text NOT NULL,
  "email" text NOT NULL,
  "name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
