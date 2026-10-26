# 03: Session lifecycle and CSRF

**What to build:** Sessions end correctly and cannot be forged cross-site. Absolute 8 h and 30 min idle limits, unlimited concurrent Sessions per Principal with a "my sessions" list and revoke-one, logout, cookie key-ring rotation, Origin and mutation-header checks, and a server-side relative return target.

**Blocked by:** 02 (web login tracer)

**Status:** ready-for-agent

- [ ] Idle Sessions expire at 30 min; no signing from an idle Session; absolute lifetime 8 h
- [ ] A user sees and can revoke any of their own Sessions
- [ ] Logout ends the Session; open redirects through the return target are rejected
- [ ] Cookie key ring rotates without logging users out
- [ ] Mutations without the required header or with a foreign Origin are rejected
