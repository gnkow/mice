CREATE TABLE IF NOT EXISTS "change_control_claims" (
  "id" text PRIMARY KEY NOT NULL,
  "signature_id" text NOT NULL,
  "claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
