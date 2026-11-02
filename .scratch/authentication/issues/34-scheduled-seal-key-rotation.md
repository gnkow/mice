Status: ready-for-agent

# 34: Scheduled seal-key rotation

**Spec:** `.specs/01-authentication.md` (U7, U16)

**Blocked by:** none

Split from issue 17. Manual normal and emergency rotation already work.

## What to build

A scheduled job runs normal seal-key rotation every 30 days. It uses the same `normalRotation` path as the admin API, so the previous key stays valid for 7 days. The job records the audit event from issue 17. Emergency rotation stays an explicit admin action.

## In code today

`boot.ts` calls `ensureBootstrapKey` and does not schedule rotation. Admins rotate from the API, the settings page, or `rotateSealKey.ts`.

## Acceptance

- [ ] The process starts a 30-day normal-rotation schedule
- [ ] A scheduled run creates a new primary key and leaves the previous key valid for 7 days
- [ ] The scheduled run writes the same audit event as a manual normal rotation
- [ ] Emergency rotation still happens only when an admin invokes it
