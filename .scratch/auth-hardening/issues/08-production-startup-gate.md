# 08: Production startup gate

**What to build:** In production the BFF refuses to start with a missing or default `SESSION_SECRET`, with `OIDC_CLIENT_SECRET` equal to the shipped `mice-auth-secret`, or with non-Secure cookies. The compose override that leaves the oxen port unpublished is documented.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] Production env with dev `SESSION_SECRET` fails validation with a clear message
- [x] Production env with `mice-auth-secret` fails validation
- [x] Production env without Secure cookies fails validation
- [x] Non-production env starts as before
- [x] Compose override for an unpublished oxen port documented in the README
