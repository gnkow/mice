CREATE TABLE "login_states" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"nonce" text NOT NULL,
	"code_verifier" text NOT NULL,
	"return_path" text,
	"reauth" jsonb,
	"expires_at" timestamp with time zone NOT NULL
);
