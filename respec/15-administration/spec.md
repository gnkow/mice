Status: ready-for-agent

# 15 — Administration console and in-app docs (PLAT-ADMIN)

## Problem Statement

Admins need one place to manage users, roles, announcements, group bootstrap rules and instance state, and users need in-app documentation.

## Solution

A settings-based admin console with an overview, announcements targeted to audiences, group-bootstrap rules seeded from environment and editable in the UI, and a docs page.

## User Stories

1. As an instance admin, I want an overview of instance state (health, revocations; GxP strict is always on and shown as fixed), so that I know what is running.
2. As an instance admin, I want to publish announcements to a namespace or group, so that messages reach the right people.
3. As a user, I want to dismiss announcements and, when flagged requires-ack, acknowledge them with a receipt (content digest plus version).
4. As an admin, I want an optional "also notify" toggle for announcements, notifying on publish only after a recipient-count confirmation.
5. As an admin, I want group-bootstrap rules seeded from env (absent keys only) and editable in the UI with audit.
6. As an admin, I want to revoke a Principal's Sessions from the UI, singly or in bulk by directory group.
7. As an admin, I want to see a Principal's effective permissions with a why-trace.
8. As a user, I want a Docs page with Mice-authored content.
9. As a translator, I want strings in a message catalog, so that locales can be added.
10. As an auditor, I want every admin change audited.

## Implementation Decisions

- The admin overview stays under `/settings`.
- Announcements are audience-targeted only and immutable; a change is a new announcement plus retiring the old one.
- Bootstrap rules: env seeds absent keys only; UI-owned keys are never overwritten; both audited. Rule-derived grants are tagged with their source and revoked at next login.
- Read receipts server-side for every requires-ack announcement; acknowledgement is not comprehension; no blocking behaviour now.
- Fail closed on IdP disablement with no break-glass path.
- Docs: English only with message-catalog readiness; versioned with the release; SOPs live outside; plain-text announcements with link allowlist and step-up.

## Testing Decisions

- HTTP tests for announcement targeting, rule editing, and audit; Playwright for the UI.
- Prior art: existing admin e2e.

## Out of Scope

Additional locales, a separate `/admin` route.

## Further Notes

Rule precedence is decided: env seeds absent keys only and UI-owned keys win (Q10).

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Announcements
- Receipt is content digest plus version; an edit creates a new version; acknowledgement, not comprehension (Q1).
- Requires-ack flag plus completion report; no blocking now (Q2).
- Immutable announcements; change means new plus retire (Q3).
- Live audience with join-time rule; report distinguishes publish-time from later joiners (Q4).
- Sensitive notices target Mice namespace membership, not IdP groups (Q5).
- Plain text, link allowlist, step-up (Q22).
- Notify on publish only; recipient-count confirmation (Q26).
- No cache; indexed query per poll (Q18); unique (principal, revision) idempotent receipts (Q19).

Access administration
- Notify other admins and QA on access-changing actions; second approver for elevation; designed to split roles later (Q6).
- Fail closed; rely on IdP disablement (Q7).
- Bulk revoke by directory group with batch id and directory sync (Q8).
- Rule-derived grants tagged by source, revoked at next login (Q9).
- Seed absent keys only; UI-owned never overwritten (Q10).
- Self-approval forbidden; second reviewer for maintain/admin; no auto-escalation (Q13).
- Directory adapter interface plus adapter for the chosen IdP (Q16).
- Minimum length, caps, audit; non-admins limited (Q17).
- Best-effort per-item results with idempotent retry (Q20).
- No cache; per-request revocation read; per-chunk recheck (Q21).
- Effective-permissions view with why-trace (Q25).
- One open request per target, cooldown, rate limit (Q27).

Docs and testing
- Docs versioned with the release; SOPs outside (Q23).
- Error codes with client translation; audit codes (Q24).
- Table-driven HTTP suite on two instances (Q28).
- Inherited: strict always on (Q11), training out of scope (Q12), service principals removed (Q14, Q15).

## Conflicts and open risks

- Q7 RISK: break-glass declined; no incident-response path if the IdP is down or an admin is locked out. Aligns with 00 Q3 (absolute fail-closed) but is an accepted operational gap.
- Q6 vs 02/04: second approver and admin+QA notifications depend on enough distinct admins; separation of duties may be unmeetable on small instances.
- Q13 forbids auto-escalation, consistent with 14 Q4; a stalled reviewer is handled only by reassignment (14 Q5).
- Q26 notify-on-publish depends on 14; admin-wide audiences require a reason and audit (14 Q24).
- Q9/Q10 interplay: env reseeding never overwrites UI keys, so a corrupted UI value persists until edited.
- Q18/Q21 no caching: per-poll and per-request database reads add load; covered by 16 Q18 targets.
- Q5 uses Mice namespace membership, not IdP groups, so IdP-side changes do not retarget sensitive notices.
- Story 1 and 7 removed references to strict-mode toggle, PATs and service principals per global decisions.

## Update from authentication review
- Q16 IdP-migration tooling is moot (auth Q80); keep only the directory adapter for the single IdP.
- Q9/Q10 bootstrap rules grant read-only baseline only; write, sign and approve need a recorded admin grant (auth R1). Rules apply to everyone including externals, so guests must be kept out of privileged IdP groups.
- Q21 no revocation cache is confirmed (auth Q79).
- Revocation and suspend fail with 503 when immudb is down; no deferred append (auth R8).
- Quarterly signed access review report (auth S3) and daily IdP drift report (auth T5) are administration features.
- Support access does not exist (auth T3); Auditors are the only cross-user readers.
