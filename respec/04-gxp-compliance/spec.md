Status: needs-info
Blocked on: reviewer escalation target and thresholds (undecided).

# 04 — GxP compliance (PLAT-GXP)

## Problem Statement

Regulated teams need Part 11 / Annex 11 oriented product controls on top of auth and audit: strict mode, reasons, e-signatures, and integrity evidence.

## Solution

A `GXP_STRICT` setting that enforces fail-closed audit, required reasons on configured mutation classes, and e-signatures on a defined action set. The initial signed action is the merge: the `maintain` user signs at merge time with meaning "Approved". There is no separate approver.

## User Stories

1. As a compliance lead, I want to enable `GXP_STRICT`, so that all strict controls turn on together.
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
14. As an operator, I want strict mode state visible in the admin overview, so that I know what is enforced.

## Implementation Decisions

- `GXP_STRICT` enables: fail-closed audit for all mutations, fail-closed lineage, reason policy, e-signature enforcement.
- E-signature scope v1: the merge action by a `maintain` user; privileged settings follow.
- Re-authentication through AUTH step-up; session cookie alone is insufficient.
- Revocation is an annotation record linked to the original; no compensating oxen commit.
- Signature records are append-only in PostgreSQL with audit events (`esign.*`).
- Session recording is optional even under strict.
- Reviewer escalation (GXP-R-058): thresholds, recipients and offboarded-reviewer fallback are undecided.
- Backup/restore integrity (GXP-R-061/063) is deferred until the deployment target is chosen.

## Testing Decisions

- HTTP tests: merge without signature is refused in strict mode; re-authentication required; revoke creates a linked record.
- Prior art: audit tests and e-sign step-up flow in Playwright.

## Out of Scope

CSV templates, backup/restore, separate approver workflow, PR-like review.

## Further Notes

Because the signer is the merger, there is no four-eyes control. Confirm this satisfies the validation strategy.
