# 19: Cross-store integrity verification

**What to build:** A scheduled job cross-checks signature records against audit events and oxen commit existence, producing a report. It is report-only: it never deletes or repairs. Alerts fire on findings.

**Blocked by:** 01; repositories/03

**Status:** done

- [x] Scheduled verification covers signatures ↔ audit ↔ oxen
- [x] Output is a report; nothing is deleted or repaired
- [x] Findings raise an operator alert
- [x] Each run is itself auditable

## Comments

**Deep-api Close (2026-11-16):** Seam `runCrossStoreIntegrity` + `startCrossStoreIntegritySchedule` (boot); admin `POST /auth/admin/integrity-check`. Report-only findings + notification + audit. Unit/integ: `crossStoreIntegrity.test.ts`.
