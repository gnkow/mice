Status: ready-for-agent

# 13: Auditor access

**Spec:** `.specs/01-authentication.md` (Q78, T3)

**Blocked by:** `.scratch/authorization/issues/16-role-based-access-control.md`

Moved from `.scratch/authentication/issues/10-auditor-access.md`. This replaces the earlier `read_only_auditor` permission sketch. The Auditor role is one of the five roles in issue 16.

## What to build

An Auditor is an IdP Principal with an admin-set expiry. Authorization enforces that expiry on every request even when the IdP account is still enabled. Auditor actions require MFA evidence. The role can read repository data, history, and audit logs across ACLs. It cannot write, merge, delete, sign, or impersonate. Every read is audited with the Auditor Principal. There is no other cross-user support account.

The admin UI grants the role with a required expiry. A grant with no expiry is rejected. An expired grant is refused on the next request.

## In code today

`auth/src/authentication/auditor/auditorAccess.ts` has pure checks for expiry, MFA, read-only, and an audit record shape, with unit tests. There is no auditor column, no session flag, no route, and no middleware that calls those checks. Signature evidence from authentication issue 26 is on the signing audit detail, with no auditor view.

## Acceptance

- [ ] An admin can grant the Auditor role only with an expiry
- [ ] A request after expiry is refused while the IdP account is still enabled
- [ ] Auditor requests require MFA evidence
- [ ] The Auditor can read repository data, history, and audit logs across ACLs
- [ ] Write, merge, delete, and sign routes reject the Auditor role
- [ ] Every Auditor read appends an audit event with that Principal
- [ ] No impersonation or support-login route exists
- [ ] The auditor view can open the signature evidence stored by authentication issue 26
