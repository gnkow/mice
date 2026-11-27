ALTER TABLE "commit_qc_status" ADD COLUMN "signature_id" text;
--> statement-breakpoint
CREATE INDEX "commit_qc_status_signature_idx" ON "commit_qc_status" USING btree ("signature_id");
