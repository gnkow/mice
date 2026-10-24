# 11: Step-up re-authentication

**What to build:** A mechanism any feature can call to demand fresh authentication: redirect to the IdP with forced login and a maximum age, then verify the returned authentication time is recent before resuming the original action. A failed or abandoned re-authentication leaves the action unperformed. PATs can never satisfy it. The authentication plan owns the mechanism; the GxP e-signature work decides when to call it.

**Blocked by:** 06 (id_token signature verification)

**Status:** ready-for-agent

- [ ] A protected action with a stale authentication time sends the User through the IdP and resumes after success
- [ ] A returned authentication time older than the maximum age is rejected and the action does not run
- [ ] Cancelled or failed re-authentication does nothing and is audited
- [ ] A PAT caller is refused
- [ ] Tested with a stub IdP; one demo route exercises it end to end
