Status: needs-info
Blocked on: Q2 vs Q3 of 13 (favorites feeding notifications vs removal of the implicit-watch claim) must be resolved here; the recipient rules cannot be finalised until then.

# 14 — Notifications (PLAT-NOTIF)

## Problem Statement

Users must learn about events relevant to them (jobs, sessions, access, approvals, quotas) without noise, and must never see events they are not allowed to see.

## Solution

The recipient projection in PostgreSQL is authoritative; Novu is the delivery service only (supersedes the ADR 0004 "Novu owns state" wording). A notification worker projects audit events, resolving recipients by access and watch rules, with in-app inbox, email and optional channels; web push is deferred.

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
11. As a user, I want own-account security alerts (new device, session revoked by an admin); these cannot be disabled.
12. As a reviewer, I want approval requests and reminders as the assigned reviewer, with no auto-escalation; any eligible maintainer may merge.
13. As an admin, I want a delivery-health view, so that failing channels are visible.
14. As a CLI user, I want `mice notifications`.

## Implementation Decisions

- Postgres holds the authoritative recipient projection; Novu (MongoDB, Redis) is delivery only. The worker is multi-instance safe with durable replay from audit; dedupe relies on the Novu transaction id (see Conflicts and open risks).
- Every catalog category is on by default; non-optional are own-account security events and approvals to the current approver.
- Rate limiting for lease-contention events; thresholds set in implementation.
- No escalation: the assigned reviewer is notified; on revoke, pending reviews are reassigned to namespace owners with notice and audit. Self-merge is forbidden.
- Optional channels (webhook, Slack, Teams) are later phases; web push deferred.
- Stuck-job recipients and subscription ownership: Notifications owns job event types; whether a per-job subscription is a favorite/watch is unresolved (13 Q2/Q3).

## Testing Decisions

- HTTP tests perform a mutation and assert the Novu-visible result for eligible and ineligible users.
- Prior art: existing notification worker tests on containers.

## Out of Scope

Escalation design (decided: none), webhook channels, web push, per-user cost controls.

## Further Notes

"All on by default" with non-optional own-account security and approval notices (Q3); everything else may be disabled.

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Authority and retention
- Recipient projection in Postgres authoritative; Novu delivers only; supersedes ADR 0004 wording (Q8).
- Notifications are non-records with 90-day content TTL in Novu and provider logs; delivery facts in audit (Q1).
- Dedupe via Novu transaction id (Q10).
- Ids and safe summaries in Novu; internal delivery dashboard; operator role (Q20).
- Pinned images, workflows as code verified at start, licence check (Q21).
- Lazy subscriber upsert; delete after revoke plus grace (Q22).

Channels and content
- Inbox on all; e-mail for personal and security; push opt-in (Q2); push deferred, generic text when enabled (Q14).
- Generic external content for restricted events and all push; detail in inbox only (Q9).
- E-mail only to verified IdP claims on a domain allow-list; else inbox only (Q13).
- Claim freshness check at dispatch; external delivery only to recently active Principals; offboarding SLA (Q12).
- BFF-built digests with permission recheck (Q15); per-recipient grouping after access filter (Q16).

Mandatory and approvals
- Non-optional: own-account security and approvals to the current approver (Q3).
- Assigned reviewer, no auto-escalation, any eligible maintainer may merge (Q4).
- On revoke, reassign pending reviews to namespace owners with notice and audit (Q5).
- Dispatch recorded for approval notices only; notifications are not evidence (Q26).
- Admin-wide audiences require a reason and audit (Q24).
- Read state exempt from audit; security/approval preference changes audited (Q25).

Operational alerts
- Notify on explicit Outcome events; inferred outcomes labelled unconfirmed with evidence (Q7).
- Wait-time threshold alerts, one per crossing, state in Postgres (Q17).
- Heartbeat-based stuck detection; user-configurable duration warnings; unresolved Intent events to admins (Q18).
- Rejection alerts outside the pipeline; hourly admin summary (Q19).

Delivery and testing
- p95 SLO per event class with recipient ceiling and CI load test (Q11).
- Decision table, generated tests, explain API (Q27).
- Pure scheduling function plus environment clock offset in test stacks (Q28).
- Poll plus cursor check backed by a Redis counter; streaming after load test (Q29).

## Conflicts and open risks

- Q10 RISK: owner overrode the recommended ledger; dedupe by Novu transaction id leaves a gap after long replays (window expiry) and conflicts with one-owner-per-fact, since the Postgres projection is authoritative.
- Q8: supersedes ADR 0004 and the glossary "Novu owns notification state"; both need updating.
- Unresolved link to 13 (Q2 vs Q3): favorites feeding notifications versus removal of the implicit-watch claim; this module must decide recipient rules.
- Q3 vs 13: favorite must not override non-optional categories or disabled categories.
- Q7: inferred outcomes (e.g. after crash with maintenance-window-only deploys, 16 Q27) may still produce unconfirmed notices.
- Q12/Q13: external delivery depends on IdP claim freshness and offboarding SLA; PATs and service principals are removed (Q23), so those recipient classes do not exist.
- Q1: 90-day TTL for notification content conflicts with any expectation of notifications as records; delivery facts live in immudb audit.
- Q29: polling first; streaming is deferred pending load test.

## Update from authentication review
- 14 Q22 IdP-migration subscriber cleanup is moot: IdP change is unsupported and iss+sub is never reused (auth Q29, Q80, S8).
- Recipient e-mail uses the IdP claim; bootstrap rules grant read-only baseline only (auth R1), so notification recipients follow actual grants.
