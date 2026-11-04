Status: done

# 13: Auditor access

**Spec:** `.specs/01-authentication.md` (Q78, T3)

**Blocked by:** `.scratch/authorization/issues/16-role-based-access-control.md`

Moved from `.scratch/authentication/issues/10-auditor-access.md`. This replaces the earlier `read_only_auditor` permission sketch. The Auditor role is one of the five roles in issue 16.

## What to build

An Auditor is an IdP Principal with an admin-set expiry. Authorization enforces that expiry on every request even when the IdP account is still enabled. Auditor actions require MFA evidence. The role can read repository data, history, and audit logs across ACLs. It cannot write, merge, delete, sign, or impersonate. Every read is audited with the Auditor Principal. There is no other cross-user support account.

The admin UI grants the role with a required expiry. A grant with no expiry is rejected. An expired grant is refused on the next request.

## In code today

Expiry, read-only enforcement, MFA gating (session id_token `acr`/`amr`) and per-read `site_admin_bypass` audit events are enforced in `authz.ts` and `proxy.ts`, with tests in `auditorAccess.enforcement.test.ts` and `auditorAccess.audit.test.ts`. The earlier unwired stub was removed. Instance actions (including audit reads) also require MFA for the Auditor role. The Audit page shows signature evidence from authentication issue 26 on `signature.created` events (`web/src/lib/signatureEvidence.ts`). The dev-session mint accepts `mfa: true` for e2e.

## Acceptance

- [x] An admin can grant the Auditor role only with an expiry
- [x] A request after expiry is refused while the IdP account is still enabled
- [x] Auditor requests require MFA evidence
- [x] The Auditor can read repository data, history, and audit logs across ACLs
- [x] Write, merge, delete, and sign routes reject the Auditor role
- [x] Every Auditor read appends an audit event with that Principal
- [x] No impersonation or support-login route exists
- [x] The auditor view can open the signature evidence stored by authentication issue 26
