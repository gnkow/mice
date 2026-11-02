Status: ready-for-agent

# 44: Hashed IP on authentication audit events

**Spec:** `.specs/01-authentication.md` (U8)

**Blocked by:** none

Split from issue 16. The salt, the hash function, and the device-approval display stay there.

## What to build

Every authentication audit event (login, refresh, logout, step-up, failure, revocation) stores `hashed_ip` as SHA-256(IP + that day's salt). The raw IP is not stored. Events with no client IP omit the field.

## In code today

`AuditEvent` has an optional `hashed_ip`. Device approval sets it. The authentication event writer in `authEvents.ts` does not.

## Acceptance

- [ ] Login, refresh, logout, step-up, failure, and revocation events store `hashed_ip` when a client IP is present
- [ ] The stored value matches `hashIp` for that IP on that UTC day
- [ ] The raw IP is absent from the audit record and from operational logs of these events
- [ ] A missing client IP leaves `hashed_ip` unset
