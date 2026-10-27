CREATE TABLE "access_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"sub" text NOT NULL,
	"iss" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"severity" text NOT NULL,
	"active" boolean NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "auth_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"type" text NOT NULL,
	"principal_key" text NOT NULL,
	"request_id" text NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_namespace_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" jsonb NOT NULL,
	"base_repository_role" text
);
--> statement-breakpoint
CREATE TABLE "custom_repo_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base" text NOT NULL,
	"permissions" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desktop_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"owner_sub" text NOT NULL,
	"owner_iss" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"body" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_approvals" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "device_approvals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"principal_key" text NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_code" text NOT NULL,
	"approver_hashed_ip" text
);
--> statement-breakpoint
CREATE TABLE "device_authorizations" (
	"device_code_hash" text PRIMARY KEY NOT NULL,
	"user_code" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"scopes" jsonb,
	"token" text,
	"pat_id" text,
	"user_sub" text,
	"user_iss" text,
	"user_email" text,
	"user_name" text,
	"device_name" text,
	"request_hashed_ip" text
);
--> statement-breakpoint
CREATE TABLE "directory_sync_revoked" (
	"principal_key" text PRIMARY KEY NOT NULL,
	"revoked_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "directory_sync_state" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"stale_alerted_at" timestamp with time zone,
	"watching_since" timestamp with time zone,
	CONSTRAINT "directory_sync_state_singleton" CHECK ("directory_sync_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"user_key" text NOT NULL,
	"type" text NOT NULL,
	"id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "favorites_user_key_type_id_pk" PRIMARY KEY("user_key","type","id")
);
--> statement-breakpoint
CREATE TABLE "idp_baseline_checks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "idp_baseline_checks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_by" text NOT NULL,
	"mfa_available" boolean NOT NULL,
	"claims_found" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "instance_admins" (
	"user_key" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instance_permissions" (
	"user_key" text NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "instance_permissions_user_key_permission_pk" PRIMARY KEY("user_key","permission")
);
--> statement-breakpoint
CREATE TABLE "instance_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"enforce" boolean DEFAULT false NOT NULL,
	CONSTRAINT "instance_settings_singleton" CHECK ("instance_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "instance_training" (
	"user_key" text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_hash_salt" (
	"date" text PRIMARY KEY NOT NULL,
	"salt" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_aliases" (
	"alias" text PRIMARY KEY NOT NULL,
	"target" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"repo" text NOT NULL,
	"status" text NOT NULL,
	"pin_commit" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"body" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lineage_ops" (
	"id" text PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"repo" text NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"body" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_states" (
	"id_hash" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"nonce" text NOT NULL,
	"code_verifier" text NOT NULL,
	"return_path" text,
	"reauth" jsonb,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_history" (
	"key" text NOT NULL,
	"revision" integer NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "meta_history_key_revision_pk" PRIMARY KEY("key","revision")
);
--> statement-breakpoint
CREATE TABLE "meta_records" (
	"key" text PRIMARY KEY NOT NULL,
	"body" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_revisions" (
	"key" text PRIMARY KEY NOT NULL,
	"value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "namespace_group_members" (
	"namespace" text NOT NULL,
	"group_key" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "namespace_group_members_namespace_group_key_pk" PRIMARY KEY("namespace","group_key")
);
--> statement-breakpoint
CREATE TABLE "namespace_members" (
	"namespace" text NOT NULL,
	"user_key" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "namespace_members_namespace_user_key_pk" PRIMARY KEY("namespace","user_key")
);
--> statement-breakpoint
CREATE TABLE "namespaces" (
	"name" text PRIMARY KEY NOT NULL,
	"base_permission" text NOT NULL,
	"members_can_create_repos" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_cursor" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"audit_seq" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "notification_cursor_singleton" CHECK ("notification_cursor"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "notification_tombstones" (
	"resource" text PRIMARY KEY NOT NULL,
	"deleted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_users" (
	"user_key" text PRIMARY KEY NOT NULL,
	"identity" jsonb NOT NULL,
	"remembered_at" timestamp with time zone NOT NULL,
	"claims_at" timestamp with time zone NOT NULL,
	"preferences" jsonb
);
--> statement-breakpoint
CREATE TABLE "pats" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"label" text NOT NULL,
	"prefix" text NOT NULL,
	"sub" text NOT NULL,
	"iss" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"scopes" jsonb,
	"source" text,
	"groups" jsonb,
	CONSTRAINT "pats_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "principal_name_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "principal_name_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"principal_id" bigint NOT NULL,
	"name" text NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "principals" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "principals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"iss" text NOT NULL,
	"sub" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"name" text
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "rate_limits_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"limit_key" text NOT NULL,
	"endpoint" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_collaborators" (
	"namespace" text NOT NULL,
	"repo" text NOT NULL,
	"user_key" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "repo_collaborators_namespace_repo_user_key_pk" PRIMARY KEY("namespace","repo","user_key")
);
--> statement-breakpoint
CREATE TABLE "repo_group_collaborators" (
	"namespace" text NOT NULL,
	"repo" text NOT NULL,
	"group_key" text NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "repo_group_collaborators_namespace_repo_group_key_pk" PRIMARY KEY("namespace","repo","group_key")
);
--> statement-breakpoint
CREATE TABLE "seal_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"key_material" text NOT NULL,
	"valid_from" integer NOT NULL,
	"valid_until" integer,
	"revoked_at" integer,
	"rotation_type" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_pat_expiry_notices" (
	"pat_id" text PRIMARY KEY NOT NULL,
	"notified_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_principals" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_iss" text NOT NULL,
	"owner_sub" text NOT NULL,
	"owner_email" text NOT NULL,
	"owner_name" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspended_cause" text
);
--> statement-breakpoint
CREATE TABLE "session_revocations" (
	"principal_key" text PRIMARY KEY NOT NULL,
	"not_before" integer,
	"sessions_not_before" integer
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
ALTER TABLE "custom_namespace_roles" ADD CONSTRAINT "custom_namespace_roles_namespace_namespaces_name_fk" FOREIGN KEY ("namespace") REFERENCES "namespaces"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_repo_roles" ADD CONSTRAINT "custom_repo_roles_namespace_namespaces_name_fk" FOREIGN KEY ("namespace") REFERENCES "namespaces"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "namespace_group_members" ADD CONSTRAINT "namespace_group_members_namespace_namespaces_name_fk" FOREIGN KEY ("namespace") REFERENCES "namespaces"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "namespace_members" ADD CONSTRAINT "namespace_members_namespace_namespaces_name_fk" FOREIGN KEY ("namespace") REFERENCES "namespaces"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "principal_name_history" ADD CONSTRAINT "principal_name_history_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_collaborators" ADD CONSTRAINT "repo_collaborators_namespace_namespaces_name_fk" FOREIGN KEY ("namespace") REFERENCES "namespaces"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_group_collaborators" ADD CONSTRAINT "repo_group_collaborators_namespace_namespaces_name_fk" FOREIGN KEY ("namespace") REFERENCES "namespaces"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "web_sessions" ADD CONSTRAINT "web_sessions_principal_id_principals_id_fk" FOREIGN KEY ("principal_id") REFERENCES "principals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_one_pending" ON "access_requests" USING btree ("sub","iss") WHERE "access_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "announcements_created" ON "announcements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "auth_events_principal_idx" ON "auth_events" USING btree ("principal_key","timestamp");--> statement-breakpoint
CREATE INDEX "auth_events_timestamp_idx" ON "auth_events" USING btree ("timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_namespace_roles_name" ON "custom_namespace_roles" USING btree ("namespace",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "custom_repo_roles_name" ON "custom_repo_roles" USING btree ("namespace",lower("name"));--> statement-breakpoint
CREATE INDEX "desktop_sessions_status" ON "desktop_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "desktop_sessions_owner" ON "desktop_sessions" USING btree ("owner_iss","owner_sub");--> statement-breakpoint
CREATE INDEX "device_approvals_principal_time_idx" ON "device_approvals" USING btree ("principal_key","approved_at");--> statement-breakpoint
CREATE INDEX "device_authorizations_user_code" ON "device_authorizations" USING btree ("user_code");--> statement-breakpoint
CREATE INDEX "favorites_target" ON "favorites" USING btree ("type","id");--> statement-breakpoint
CREATE INDEX "idp_baseline_checks_checked_at_idx" ON "idp_baseline_checks" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "jobs_repo_created" ON "jobs" USING btree ("namespace","repo","created_at");--> statement-breakpoint
CREATE INDEX "jobs_status_created" ON "jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "jobs_pin_commit" ON "jobs" USING btree ("pin_commit");--> statement-breakpoint
CREATE INDEX "lineage_ops_repo_ts" ON "lineage_ops" USING btree ("namespace","repo","ts");--> statement-breakpoint
CREATE INDEX "namespace_group_members_group" ON "namespace_group_members" USING btree ("group_key");--> statement-breakpoint
CREATE INDEX "namespace_members_user" ON "namespace_members" USING btree ("user_key");--> statement-breakpoint
CREATE INDEX "pats_owner" ON "pats" USING btree ("iss","sub");--> statement-breakpoint
CREATE INDEX "principal_name_history_principal_idx" ON "principal_name_history" USING btree ("principal_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "principals_iss_sub_key" ON "principals" USING btree ("iss","sub");--> statement-breakpoint
CREATE INDEX "rate_limits_key_endpoint_time_idx" ON "rate_limits" USING btree ("limit_key","endpoint","requested_at");--> statement-breakpoint
CREATE INDEX "repo_collaborators_user" ON "repo_collaborators" USING btree ("user_key");--> statement-breakpoint
CREATE INDEX "repo_group_collaborators_group" ON "repo_group_collaborators" USING btree ("group_key");--> statement-breakpoint
CREATE INDEX "seal_keys_valid_from_idx" ON "seal_keys" USING btree ("valid_from");--> statement-breakpoint
CREATE INDEX "seal_keys_valid_until_idx" ON "seal_keys" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "service_principals_owner" ON "service_principals" USING btree ("owner_iss","owner_sub");--> statement-breakpoint
CREATE INDEX "web_sessions_principal_idx" ON "web_sessions" USING btree ("principal_id");