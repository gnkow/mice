ALTER TABLE "instance_permissions" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
UPDATE "instance_permissions" SET "expires_at" = '9999-12-31T00:00:00.000Z' WHERE "expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "instance_permissions" ALTER COLUMN "expires_at" SET NOT NULL;
