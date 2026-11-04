CREATE FUNCTION "rbac_history_append_only"() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "principal_role_history_append_only" BEFORE UPDATE OR DELETE ON "principal_role_history" FOR EACH ROW EXECUTE FUNCTION "rbac_history_append_only"();
--> statement-breakpoint
CREATE TRIGGER "principal_role_history_no_truncate" BEFORE TRUNCATE ON "principal_role_history" FOR EACH STATEMENT EXECUTE FUNCTION "rbac_history_append_only"();
--> statement-breakpoint
CREATE TRIGGER "principal_permission_history_append_only" BEFORE UPDATE OR DELETE ON "principal_permission_history" FOR EACH ROW EXECUTE FUNCTION "rbac_history_append_only"();
--> statement-breakpoint
CREATE TRIGGER "principal_permission_history_no_truncate" BEFORE TRUNCATE ON "principal_permission_history" FOR EACH STATEMENT EXECUTE FUNCTION "rbac_history_append_only"();
--> statement-breakpoint
CREATE TRIGGER "permission_snapshots_append_only" BEFORE UPDATE OR DELETE ON "permission_snapshots" FOR EACH ROW EXECUTE FUNCTION "rbac_history_append_only"();
--> statement-breakpoint
CREATE TRIGGER "permission_snapshots_no_truncate" BEFORE TRUNCATE ON "permission_snapshots" FOR EACH STATEMENT EXECUTE FUNCTION "rbac_history_append_only"();
--> statement-breakpoint
ALTER TABLE "principal_role_history" DROP CONSTRAINT "principal_role_history_principal_id_principals_id_fk";
--> statement-breakpoint
ALTER TABLE "principal_role_history" ADD CONSTRAINT "principal_role_history_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "principal_permission_history" DROP CONSTRAINT "principal_permission_history_principal_id_principals_id_fk";
--> statement-breakpoint
ALTER TABLE "principal_permission_history" ADD CONSTRAINT "principal_permission_history_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "permission_snapshots" DROP CONSTRAINT "permission_snapshots_principal_id_principals_id_fk";
--> statement-breakpoint
ALTER TABLE "permission_snapshots" ADD CONSTRAINT "permission_snapshots_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;
