# 10: Auditor access

**What to build:** An inspector or internal auditor reads records with the Auditor role through an external IdP account. Mice enforces an admin-set expiry, requires MFA evidence, audits every read, and grants no write capability. No support access or impersonation exists.

**Blocked by:** 06 (revocation and suspension), 09 (signing ceremony)

**Status:** ready-for-agent

- [ ] Auditor access stops at the expiry even if the IdP account stays active
- [ ] No write or sign action is possible with the Auditor role
- [ ] Every read is audited with the Principal
- [ ] No impersonation and no other cross-user support access path exists
- [ ] Bootstrap rules cannot grant Auditor
