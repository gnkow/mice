CREATE TABLE "principals" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "principals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"iss" text NOT NULL,
	"sub" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "web_sessions" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"principal_id" bigint NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"name" text NOT NULL,
	"id_token" text,
	"groups" jsonb NOT NULL,
	"auth_time" integer,
	"session_start" integer NOT NULL,
	"last_active" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "web_sessions" ADD CONSTRAINT "web_sessions_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "principals_iss_sub_key" ON "principals" USING btree ("iss","sub");--> statement-breakpoint
CREATE INDEX "web_sessions_principal_idx" ON "web_sessions" USING btree ("principal_id");