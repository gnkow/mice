# 10: Notifications are delivered through Novu

**What to build:** The compose stack runs Novu with MongoDB and Redis. The notification worker projects audit events into Novu through its API and records its last audit position in PostgreSQL so a restart neither misses nor duplicates events. The web inbox reads and updates read state through the BFF, which talks to Novu.

**Blocked by:** 03, 09

**Status:** done

- [ ] Novu, MongoDB and Redis start healthy with volumes and secrets
- [ ] `/readyz` reports Novu
- [ ] The worker resumes from its stored position after restart
- [ ] The web inbox lists, marks read and shows unread counts via Novu
- [ ] The old notification store and its legacy handling are deleted
- [ ] Targeted e2e passes (notifications)

## Outcome

Notifications run on Novu 3.19.0 (api, worker, MongoDB, Redis in compose); PostgreSQL holds users, preferences, tombstones and the audit replay cursor (read from immudb with `readAfter`). Email, push, the delivery queue and the push routes were dropped (`nodemailer`, `web-push` removed). `/readyz` reports `notifications`; the inbox answers 503 when Novu is down. Tests use the real Novu with per-file issuers and purge their subscribers. Targeted e2e `notifications.spec.ts` passes.
