# 10: Stale directory-sync alert

**What to build:** When the last successful directory sync is older than twice the interval, record an audit event and notify instance admins through the notification system, so admins know offboarding is not running. A later successful run clears the condition and does not re-alert until it goes stale again.

**Blocked by:** 09 (Directory-sync revocation)

**Status:** done

- [x] Past 2x the interval without a success, an audit event and one admin notification are produced
- [x] The alert is not repeated on every check while still stale
- [x] A successful run clears the stale state
- [x] Non-admins receive nothing
- [x] Tested with a fake clock and a stub directory client
