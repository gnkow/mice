# 05: Session revocation by not-valid-before

**What to build:** An instance admin can revoke all Sessions of a Principal; their existing cookies stop working immediately without a server-side session table. The mechanism is a per-`iss`+`sub` not-valid-before timestamp checked on every request.

**Blocked by:** 03 (`iss`+`sub` identity key)

**Status:** ready-for-agent

- [x] Admin action in Settings sets not-valid-before for a Principal
- [x] A Session issued before that time gets `401` on the next request
- [x] A fresh login after revocation works
- [x] Non-admins cannot revoke
- [x] Revocation is audited
- [x] Playwright: revoke while the User is signed in
