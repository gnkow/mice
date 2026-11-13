# 14: Backup target start gate

**What to build:** The instance refuses to start unless a backup target is configured and reachable.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Start fails without a configured backup target
- [x] Start fails when the backup target is unreachable
- [x] Successful start records that the backup target check passed

## Notes

- Production `startupGate` requires `BACKUP_TARGET` via `backupTargetProblems` → `evaluateBackupTarget`.
- Successful production boot appends `system.backup_target.check` after the gate.

## Comments

- **Audit:** holds at gate (import already on master) but module was missing from git — shipped `backupTarget.ts` + boot audit. Unit present; integration via `startupGate.test.ts` (thin → thickened with `evaluateBackupTarget`).
- **Deepen (auto-pick Top):** `evaluateBackupTarget` as the single policy seam; `backupTargetProblems` and `recordBackupTargetCheck` both go through it.
- **Seams:** `evaluateBackupTarget` / `backupTargetProblems` (module); `assertProductionStartup` (startup); `recordBackupTargetCheck` at boot (audit).
