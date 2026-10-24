# 08: Back-channel logout

**What to build:** The BFF accepts an IdP back-channel logout request. A valid logout token ends all Sessions of the named Principal (`iss`+`sub`) by setting the sessions-only cut-off. PATs are untouched, because logout is not offboarding. Forged, expired, wrong-audience or wrong-issuer tokens are rejected. The event is audited with source `back-channel-logout`.

**Blocked by:** 02 (Two-cut-off revocation), 06 (id_token signature verification, reused for logout-token signatures)

**Status:** ready-for-agent

- [ ] A valid logout token ends the Principal's existing Sessions and leaves PATs valid
- [ ] Bad signature, expired, wrong audience, wrong issuer or missing logout event claim are rejected with no effect
- [ ] A replayed valid token is harmless
- [ ] The audit record carries the Principal and source
- [ ] Tested through the HTTP wiring seam with a stub IdP
