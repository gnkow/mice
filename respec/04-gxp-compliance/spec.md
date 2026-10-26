Status: needs-info
Blocked on: (1) owner confirmation of reviewer escalation (Q18: no auto-escalation v1; GXP-R-058 thresholds, recipients and offboarded-reviewer fallback unconfirmed); (2) Q22 recording conflict with the global decision (recording of desktop sessions never); (3) research-repo exemption from always-on strict (Q10, open).

# 04 — GxP compliance (PLAT-GXP)

## Problem Statement

Regulated teams need Part 11 / Annex 11 oriented product controls on top of auth and audit: strict mode, reasons, e-signatures, and integrity evidence.

## Solution

Strict mode is always on (not a switch). It enforces fail-closed audit, required reasons on configured mutation classes, and e-signatures on a defined action set. The initial signed action is the merge: an eligible `maintain` user other than the author signs at merge time with meaning "Approved" (stored as a field). There is no separate approver role.

## User Stories

1. As a compliance lead, I want strict controls always on and not switchable, so that no instance can run unregulated.
2. As a repository maintainer, I want to sign a merge with fresh re-authentication, so that the signature is attributable.
3. As an auditor, I want the signature to show printed name, date and time, and meaning, so that it is legible.
4. As an auditor, I want the signature bound to the action, resource and version, so that a later change invalidates it.
5. As a user, I want to be required to give a reason on configured mutations, so that changes are justified.
6. As a user, I want to attach an optional change-control id, so that I can link to our QMS.
7. As an auditor, I want every signature attempt, success or failure, audited, so that attempts are accountable.
8. As a compliance lead, I want signatures never edited or deleted, so that they are non-repudiable.
9. As a maintainer, I want to revoke a signature, so that an erroneous approval is corrected.
10. As an auditor, I want revocation recorded as a new linked record with a reason, with oxen history unchanged, so that the original remains visible.
11. As a compliance lead, I want no product API to purge audit or signature history in strict mode, so that records stay complete.
12. As an auditor, I want to verify integrity of regulated records, so that I can attest completeness.
13. As a compliance lead, I want unique signing identity, so that credentials are never shared.
14. As an operator, I want the effective regulated configuration visible in the admin overview and written to audit at each start or change, so that I know what is enforced.

## Implementation Decisions

- Strict mode is permanently on and enables: fail-closed audit for all mutations, fail-closed lineage, reason policy, e-signature enforcement.
- E-signature scope v1: the merge action by a `maintain` user; privileged settings follow.
- Re-authentication through AUTH step-up; session cookie alone is insufficient.
- Revocation is an annotation record linked to the original; no compensating oxen commit.
- The full signature record lives in immudb (append-only, with `esign.*` audit events); PostgreSQL holds only an index.
- Recording of desktop Sessions never happens (global decision); compensating controls are in the Sessions module.
- Reviewer escalation (GXP-R-058): role-only gate; no auto-escalation in v1; owner confirmation pending.
- Backup/restore integrity (GXP-R-061/063) is a hard start gate; the target is Kubernetes (Compose dev-only).

## Testing Decisions

- HTTP tests: merge without signature is refused in strict mode; re-authentication required; revoke creates a linked record.
- Prior art: audit tests and e-sign step-up flow in Playwright.

## Out of Scope

CSV templates, separate approver workflow, PR-like review.

## Further Notes

Self-signing is forbidden in GxP namespaces and self-merge is forbidden everywhere, so another eligible maintainer must sign the merge; every repository needs at least two eligible maintainers. Confirm this satisfies the validation strategy.

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Signatures and Pins
- One meaning (Approved) in v1, stored as a field; configurable list later (Q2).
- Signature binds source head, target head and merge-result content digest; refuse if any moved (Q5).
- Printed name, iss, sub and time are snapshotted at signing; optional "now known as" note (Q9).
- Full signature record in immudb; Postgres index only (Q8).
- SHA-256 manifest computed at signature time, incrementally cached, stored before the signature is final (Q23).
- Any eligible maintainer (at least two per repo) can merge and sign; Owner can assign others, audited; no auto-escalation in v1 (Q18).

Revocation
- Revocation lifts approved status on dependent Pins, warns downstream lineage, and always blocks new Pins on revoked commits (Q6).
- Revocation is itself a signed action (reason, step-up) by the signer or QA role; notifies Owners; a maintainer self-revoke alerts QA (Q7).

Re-authentication and sessions
- The IdP must assert auth method and max age (acr/amr/auth_time) or the step-up is refused; the IdP is the documented validated boundary (Q4).
- Idle 15 min and absolute 8 h are mandatory; the instance refuses to start with looser values (Q19).

Strict mode, reasons and change control
- Strict is no longer a switch: always on. A per-repo regulated flag is superseded; whether research repos need an exemption is open (Q10).
- Effective regulated configuration is written to audit at each start or change; policy changes are signed when per-repo (Q11).
- On audit outage, hold outputs, lineage and everything in the Workspace until audit recovers; held-output retention must be defined (Q12).
- Reasons need a minimum length, a pick-list category and free text; the QMS change-control id is mandatory for chosen classes (Q13).
- Change-control id uses a configurable per-namespace pattern, required for chosen classes, default-on for destructive and privileged actions (Q14).

Integrity and reporting
- Backup configured and restore tested is a hard start gate, built now (Q16).
- Scheduled cross-store verification is report-only and never deletes or repairs (Q17).
- A platform-generated signed-record report per repo (PDF plus machine-readable) (Q24).
- Requirement id in test names; a generated traceability matrix ships as a release artifact stored with the audit trail (Q26).

Inherited (not restated): Q1, Q3, Q15, Q20, Q21, Q22 (superseded, see below), Q25.

## Conflicts and open risks

- Q22 inherited 00 Q22 (recording mandatory for GxP-touching Sessions), but 10-sessions Q4 reversed it: recording never. The spec follows the global decision; the validation strategy must rely on the compensating controls (single rw session per Workspace, off-box auditd). RISK.
- Q10: possible exemption of research repos from always-on strict is open. PENDING.
- Q18: no auto-escalation and escalation thresholds, recipients and offboarded-reviewer fallback not confirmed by the owner; this is the blocker. PENDING.
- Q16 conflicts with the earlier "backup deferred" stance; backup/restore must now be built before the first start. OVERRODE.
- Q12: held-output retention is undefined. DEFERRED.
- Q8 moves the signature record to immudb; 03-audit must carry the record size and verification proofs.
- Q18 relies on 02 Q1 (forbid self-merge, at least two mergers per repo); small teams with one maintainer cannot merge.
- Q3/00 Q3 absolute fail-closed (no protective exemption) combined with Q12 holds is a documented availability risk.
- Lease renewals are audited per renewal; no exception. RESOLVED.
- Q17 report-only verification is consistent with 05 Q22 (no purge in product).
