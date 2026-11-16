# 20: Signed-record report

**What to build:** The platform generates a per-repository signed-record report (PDF plus machine-readable) of approvals and revocations with manifestation (printed name, time, meaning, binding), suitable for inspection.

**Blocked by:** 01, 05, 07

**Status:** done

- [x] Per-repo report lists approvals and revocations with manifestation fields
- [x] Report is available as PDF and as a machine-readable export
- [x] Report content matches the authoritative immudb records
- [x] Generation is auditable

## Comments

**Deep-api Close (2026-11-16):** Seam `buildSignedRecordReport`; route `GET /auth/repos/:ns/:repo/signed-record-report` (`?format=pdf`). Approvals + revocations from signature store; audit on generate. Unit: `signedRecordReport.test.ts`.
