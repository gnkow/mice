# 06: Revocation and suspension

**What to build:** Admins and the IdP can end access at once. Admin revoke-all, security-role suspend with a second admin confirming within 24 h, self-suspend, the `ACCESS_REVOKED` error, and role/grant changes that end the Principal's Sessions and CLI credentials. Back-channel logout is fully validated.

**Blocked by:** 05 (authentication event audit and failure alerts)

**Status:** ready-for-agent

- [ ] Revoked or suspended Principal gets `ACCESS_REVOKED` on the next request, with no revocation cache
- [ ] Revoke and suspend return 503 when the audit Intent cannot be appended; there is no deferred append or break-glass
- [ ] Second-admin confirmation required within 24 h; unconfirmed suspend lapses per spec
- [ ] Role or grant change forces a fresh login
- [ ] Back-channel logout validates signature, issuer, audience, events and nonce, and rejects jti replay
