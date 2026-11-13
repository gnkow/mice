# 13: Audit health probe and HA gate

**What to build:** An audit health probe and operator alert on audit degradation are required. A single immudb instance is unsupported for production.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Health probe reports audit availability
- [x] Operator alert fires on audit degradation
- [x] Production configuration refuses a single-instance immudb deployment

## Notes

- `/readyz` already reported audit store/chain; admin Settings → Audit health surfaces the same probe plus HA attestation and outage history (`GET/POST /auth/admin/audit-health/*`).
- Degradation opens a Postgres `audit_outages` incident (IdP-outage shape) and notifies instance admins; append/verify recovery closes it. Paper procedure: `validation-pack:audit-outage`.
- Production startup requires `IMMUDB_HA=true` (operator attestation that immudb is not a single instance).

## Comments

- **Audit:** holds (probe + HA gate + outage alert already on master). Unit thin → thickened; integration present (`auditHealthRoutes.test.ts`, `/readyz`).
- **Deepen (auto-pick Top):** export `immudbHaStatus` from `auditOutage.ts`; `auditHealthRoutes` and `startupGate` share `immudbHaAttested`/`immudbHaStatus` (one HA policy seam).
- **Seams:** `immudbHaAttested` / `immudbHaStatus` (module); `GET/POST /auth/admin/audit-health/*` (HTTP); production `assertProductionStartup` (startup).
