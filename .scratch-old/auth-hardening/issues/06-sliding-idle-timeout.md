# 06: Sliding idle timeout

**What to build:** An idle Session ends after `SESSION_IDLE_SEC`, while activity keeps it alive by re-sealing the cookie. The absolute TTL still applies. PLAT-GXP owns the configured value; this ticket owns the mechanism.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] Request after `SESSION_IDLE_SEC` of inactivity returns `401`
- [x] Activity within the window extends the Session
- [x] Absolute TTL still ends the Session regardless of activity
- [x] Unset `SESSION_IDLE_SEC` keeps current behaviour
