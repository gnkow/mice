CREATE TABLE "audit_outages" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_outages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"check" text NOT NULL,
	"request_id" text NOT NULL,
	"paper_procedure" text NOT NULL
);
