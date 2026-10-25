---
status: accepted
---

# Durable state lives in one SQLite database behind the persistence seam

The BFF kept about 25 stores as JSON documents and JSONL logs under `AUTH_DATA_DIR`. The audit trail, notification replay and every authorization document depended on file semantics (byte offsets, rename-based atomicity, nothing stopping a rewrite). We keep the existing seam (`DocumentStore`, `AppendOnlyLog`, `JsonlLog` over `jsonStore.ts`) and add a SQLite adapter on the built-in `node:sqlite`, which becomes the production default. Documents are rows keyed by their path relative to the database directory; logs are rows with a per-log sequence. WAL with `synchronous=FULL` makes each acknowledged write durable, `atomically` groups writes into one transaction, and triggers make the audit, checkpoint and key logs reject UPDATE and DELETE in storage. Notification replay uses a row sequence (`auditSeq`) instead of a byte offset. On first boot a one-time importer copies every legacy file verbatim (audit hashes are untouched), verifies the copy inside the transaction, then moves the originals to `legacy-import/`; any failure rolls back and refuses to start.

## Considered options

- PostgreSQL: better for several writers, but the client is asynchronous, so every synchronous store call site (and the "never await inside a transaction" rule the stores rely on) would need rewriting, and it adds a service to operate. The BFF is deliberately a single writer (`dataDirLock`, single notification worker), so the extra capability is unused. Revisit only if the BFF ever runs as more than one process.
- `better-sqlite3` or another native driver: same model, but a native build in the Alpine image. `node:sqlite` needs nothing and works on Node 22 and later (it prints an experimental warning on 22).
- Keep files and add fsync/locking: fixes durability but not tamper resistance or the byte-offset cursor.

## Consequences

- Stays on disk by design: workspace trees, `state.json`, `base.json`, `changes-cache.json`, `.leases.json`, job logs and work directories, checkout caches and the oxen store. They are bulk or tree-shaped artefacts that are read with the filesystem and move with their directory.
- Tampering with the audit trail now requires deliberately dropping the trigger protection; chain verification still detects it and blocks mutations until acknowledged.
- Backups use `make db-backup` (`VACUUM INTO`, consistent while running). Restore is: stop the stack, put the copy at `AUTH_DATABASE_PATH`, start.
- Round two: the schema is versioned (`PRAGMA user_version`, ordered migrations in `sqliteBackend.ts`, each in one transaction; a newer database refuses to open) and `PRAGMA quick_check` runs at open. A new `Collection` interface (`get/put/remove/list`, rows in `collection_rows`) holds jobs, desktop sessions and lineage ops, so changing one record writes one row; migration v3 converts the former `jobs.jsonl`, `sessions.jsonl` and `lineage.jsonl` log rows and the importer maps those files the same way. Notification entries, deliveries and events are rows too; the document keeps the cursor, users, preferences, subscriptions and tombstones, and a legacy document that still embeds them is moved out on its next change.
- `/readyz` checks the audit store from its newest row without reading the trail.
- Disk-resident JSON (workspace `state.json`, `base.json`, leases) goes through `DiskDocument`: one corruption rule (unreadable reads as absent) and atomic writes. `changes-cache.json` stays a best-effort async cache owned by the scanner.
- Scheduled backups (`AUTH_BACKUP_INTERVAL_HOURS`, off by default; `AUTH_BACKUP_KEEP`, `AUTH_BACKUP_DIR`) are verified (opened, `quick_check`, schema version) before older copies are pruned. Backups beside the database share its disk: point `AUTH_BACKUP_DIR` at another volume for real protection.
