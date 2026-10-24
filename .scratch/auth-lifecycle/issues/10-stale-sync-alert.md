# 10: Stale directory-sync alert

**What to build:** When the last successful directory sync is older than twice the interval, record an audit event and notify instance admins through the notification system, so admins know offboarding is not running. A later successful run clears the condition and does not re-alert until it goes stale again.

**Blocked by:** 09 (Directory-sync revocation)

**Status:** ready-for-agent

- [ ] Past 2x the interval without a success, an audit event and one admin notification are produced
- [ ] The alert is not repeated on every check while still stale
- [ ] A successful run clears the stale state
- [ ] Non-admins receive nothing
- [ ] Tested with a fake clock and a stub directory client
