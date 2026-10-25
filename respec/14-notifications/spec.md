Status: needs-info
Blocked on: reviewer escalation targets and thresholds (undecided); definition of "mandatory" vs preferences now that all categories default on.

# 14 — Notifications (PLAT-NOTIF)

## Problem Statement

Users must learn about events relevant to them (jobs, sessions, access, approvals, quotas) without noise, and must never see events they are not allowed to see.

## Solution

Novu owns notification state. A notification worker projects audit events into Novu, resolving recipients by access and watch rules, with in-app inbox, email, web push and optional channels.

## User Stories

1. As a user, I want notifications for resources I can access by default, so that I need no setup.
2. As a user, I want to mute a resource or category, so that I control noise.
3. As a user, I want to disable a category globally, so that I opt out entirely.
4. As a user, I want the precedence of mute, override and category disable to be documented and consistent.
5. As an offline user, I want events delivered when I return, so that I miss nothing.
6. As a user, I want to be notified of my own job and session outcomes but not my routine edits.
7. As a user, I want inbox read state and counts, grouping and live updates.
8. As a user, I want email immediate or digest delivery, with quiet hours.
9. As a user who lost access to a resource, I want its notifications to stop revealing details.
10. As a workspace owner, I want lease contention (rate-limited), quota, failed commit and stuck-operation alerts.
11. As an admin, I want security alerts (PAT expiry, admin revoke, new device).
12. As a reviewer, I want approval requests, reminders and escalation, so that merges are signed in time.
13. As an admin, I want a delivery-health view, so that failing channels are visible.
14. As a CLI user, I want `mice notifications`.

## Implementation Decisions

- Novu (MongoDB, Redis) is the notification store; the worker is idempotent and multi-instance safe, with durable replay from audit.
- Every catalog category is on by default.
- Rate limiting for lease-contention events; thresholds set in implementation.
- Escalation targets, thresholds and the offboarded-reviewer fallback are undecided and block approval escalation.
- Optional channels (webhook, Slack, Teams) are proposals retained as later phases.
- Stuck-job recipients and subscription ownership: Notifications owns job event types; per-job subscription is a favorite/watch.

## Testing Decisions

- HTTP tests perform a mutation and assert the Novu-visible result for eligible and ineligible users.
- Prior art: existing notification worker tests on containers.

## Out of Scope

Escalation design, webhook channels, per-user cost controls.

## Further Notes

"All on by default" means no mandatory/opt-in split; security events still need a rule on whether they can be disabled.
