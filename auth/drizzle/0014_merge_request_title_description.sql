ALTER TABLE "merge_requests" ADD COLUMN "title" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "merge_requests" ADD COLUMN "description" text NOT NULL DEFAULT '';
