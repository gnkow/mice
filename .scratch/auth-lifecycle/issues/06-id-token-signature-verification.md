# 06: id_token signature verification

**What to build:** At login the BFF verifies the id_token signature against the IdP's published key set. Only RS256 and ES256 are accepted. If the key set cannot be fetched, login fails with an error and creates no Session. IdP key rotation works without a restart. Verification is on by default in GxP-strict mode and opt-in elsewhere; the existing behaviour stays the default for non-strict deployments. A maintained JWT library is the only new dependency.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A token with a bad signature, an unexpected algorithm (including none) or an unknown key is rejected
- [ ] A valid RS256 and a valid ES256 token log in
- [ ] A key-set fetch failure returns an error and sets no Session cookie
- [ ] A rotated signing key is picked up without restart
- [ ] On by default with GxP-strict; off by default otherwise; opt-in setting documented
- [ ] Tested through the HTTP wiring seam with a stub IdP key set
