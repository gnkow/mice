CREATE TABLE "principal_flag_history" (
  "id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "principal_id" bigint NOT NULL REFERENCES "principals"("id") ON DELETE cascade,
  "flag" text NOT NULL,
  "action" text NOT NULL,
  "reason" text NOT NULL,
  "actor_iss" text NOT NULL,
  "actor_sub" text NOT NULL,
  "at" timestamp with time zone NOT NULL
);
