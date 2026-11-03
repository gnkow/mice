CREATE TABLE IF NOT EXISTS "group_display_names" (
	"issuer" text NOT NULL,
	"group_id" text NOT NULL,
	"display_name" text NOT NULL,
	"id_based" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "group_display_names_issuer_group_id_pk" PRIMARY KEY("issuer","group_id")
);
