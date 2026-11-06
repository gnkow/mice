ALTER TABLE "namespaces" ADD COLUMN "change_control_id_pattern" text DEFAULT '^[A-Za-z0-9][A-Za-z0-9._/-]{2,127}$' NOT NULL;
