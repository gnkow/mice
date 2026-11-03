ALTER TABLE "access_requests" ADD COLUMN "requested_role" text;--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN "requested_permissions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN "request_type" text;--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN "approval_reason" text;--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN "granted_role" text;--> statement-breakpoint
ALTER TABLE "access_requests" ADD COLUMN "granted_permissions" text[];
