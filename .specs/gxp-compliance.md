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

---

# Open Questions


Status: needs-info; a requirements catalog of 40-odd GXP-R rows, almost all Todo, with escalation, backup and integrity verification open. Code today has step-up and strict-mode hooks for the ID token only, no e-signature store, reason policy or signature enforcement.
Biggest risks: the "maintain signs their own merge as Approved" design gives no independent approval; signatures live in a mutable database; strict mode is a global flag with unclear transitions; "GxP-capable" is claimed while backup, restore and escalation are deferred.

## Q1 [Domain] Is a self-approved merge an "Approved" signature, or a Part 11 meaning that misleads?
The owner decided that the `maintain` user who merges signs with the meaning "Approved" and there is no separate approver. The person who authored and the person who approves can be the same human. Most GxP quality systems treat approval as an independent act (four-eyes); the spec itself flags this as unconfirmed against the validation strategy.
Example: Dr. Weber pushes a corrected assay result to branch "fix-7", has `maintain`, merges it herself, and the signature records "Approved by Weber". An inspector reading it concludes a second person reviewed the correction.
Options: (a) require the signer to differ from the author of the commits being merged (cheap, real four-eyes, blocks solo labs); (b) distinct meanings "Authored/Merged" vs "Approved" so the record states the truth; (c) keep as decided and document that approval means self-approval.
Recommendation: (b) as a minimum and (a) as a per-repository strict option.
Challenges: "the `maintain` user signs at merge time with meaning 'Approved'. There is no separate approver."

## Q2 [Domain] Is the signature meaning list closed, and who defines it?
Part 11 §11.50 requires the meaning (review, approval, responsibility, authorship) to be part of the manifestation. The plan names "Approved" and "Reviewed" as examples, but the decision admits only one. Regulated sites will want "Reviewed", "Verified" and "Released" for other actions as the scope grows to privileged settings.
Example: A site has SOP "data release requires reviewer, then QA release". The platform can only record "Approved" once, by one person.
Options: (a) a configurable, audited list of meanings per signed action; (b) fixed three meanings; (c) one meaning for v1 and a documented extension point.
Recommendation: (c) now, with the data model carrying the meaning as a field so (a) is additive.
Challenges: "initial signed action is the merge ... meaning 'Approved'".

## Q3 [Impl] Do we trust step-up while the ID token signature is not verified?
ADR 0001 accepts the ID token without signature verification and takes `auth_time` from it. E-signature re-authentication rests on a fresh `auth_time` claim from that token. The configuration verifies signatures by default only under strict mode, which contradicts the ADR's accepted state. Some IdPs ignore the request for forced re-login, and the claim then reports the old time.
Example: The signer clicks "sign", the IdP silently reuses its SSO cookie and returns an `auth_time` from 3 hours ago; the BFF either rejects (user stuck) or, if the check is loose, accepts.
Options: (a) strictly verify the ID token signature and `auth_time` age in strict mode and amend the ADR; (b) require IdP-asserted authentication context/method claims as well; (c) keep as is, rely on TLS only.
Recommendation: (a) and (b); add a startup check of the IdP's capabilities.
Challenges: ADR 0001 (no JWKS verification) vs "Re-authentication through AUTH step-up".

## Q4 [Domain] Does IdP step-up meet the "two distinct identification components" rule?
Part 11 §11.200 requires, for the first signing in a session, both identification code and password or equivalent, and for subsequent signings at least one. With federated SSO the platform never sees a password; a passkey tap or an SSO cookie replay may be the "re-authentication". The platform cannot guarantee what the IdP did.
Example: An IdP configured for 12-hour SSO and a no-prompt policy lets the signer "re-authenticate" with no interaction.
Options: (a) require the IdP to assert a specific authentication method and max age, and refuse the signature otherwise; (b) a platform-owned second factor (e.g. TOTP) at signing (strong, duplicates the IdP); (c) document the IdP as part of the validated boundary.
Recommendation: (a) and (c).
Challenges: "External IdP required"; "Re-authentication through AUTH step-up".

## Q5 [Impl] What exactly is a signature bound to, given head-bound single-use with 10-minute expiry?
The plan binds a signature to action, resource and version and makes it single-use and expiring. The merge target moves constantly in active repositories and commit ids come from oxen's non-cryptographic hash. A signature bound only to the source head says nothing about what the merge result contained.
Example: Weber signs at 10:00 with source head S5 and target head T2. At 10:03 someone pushes T3. The merge is still "mergeable" but its result differs from what Weber reviewed.
Options: (a) bind source head, target head and the computed merge result digest, refuse if any moved (exact, many re-signs); (b) bind source head only (simple, weaker); (c) bind a SHA-256 content manifest of the resulting tree.
Recommendation: (a) with (c) for evidence.
Challenges: "Signatures are single-use, head-bound"; "bound to action, resource and version".

## Q6 [Domain] A revoked signature has no effect on the data. Is that useful?
Revocation is annotation-only and no compensating commit is made. The merged data remains on the main line, Jobs keep Pinning it and Desktop Sessions keep reading it. A revoked "Approved" merge therefore changes nothing operationally; people downstream have no signal.
Example: A merge approving 2,000 sample results is revoked on Friday for a mislabelled plate. On Monday a Job Pinned to that commit produces a report with no warning.
Options: (a) revoked commits are flagged on the repo, in lineage, on Pins, with warnings and a notification to dependent owners (visible, cross-module work); (b) revocation also blocks new Pins on that commit; (c) annotation only.
Recommendation: (a) plus (b) in strict mode.
Challenges: "Signature revocation annotation-only"; "no compensating oxen commit".

## Q7 [Domain] Who can revoke a signature, and can it be self-revoked silently?
Story 9 gives the maintainer the right to revoke. The same maintainer may be the signer. A person can approve a change and later retract it without anyone else involved, and a revocation of an earlier revocation has not been defined. An admin, or a QA person without `maintain`, may be the one who must revoke.
Example: A maintainer quietly revokes their own signature after an audit finding, so the finding's evidence now reads "revoked".
Options: (a) revoke is a signed action itself (reason, step-up) by signer or QA role; (b) any `maintain`; (c) only a separately assigned quality role.
Recommendation: (a), with notification to the namespace owners.
Challenges: user story 9; plan decision on revocation.

## Q8 [Impl] Signatures are "append-only in PostgreSQL". Who enforces that?
ADR 0005 exists because a PostgreSQL INSERT-only role is only a configuration property and not tamper evident. Signature records are a more important evidence class than most audit events, and the spec stores them exactly the way ADR 0005 rejected.
Example: A DBA runs an UPDATE on the printed-name column of a signature row to fix a typo; nothing detects it, and the esign.create audit event contains different text.
Options: (a) store the full signature record (manifestation, binding) in immudb and keep PostgreSQL as an index; (b) hash-link PostgreSQL rows and publish periodic roots; (c) keep as decided with database role restrictions.
Recommendation: (a).
Challenges: "Signature records are append-only in PostgreSQL" vs ADR 0005 reasoning.

## Q9 [Domain] The manifestation uses a printed name from IdP claims. What if it changes or the person leaves?
Part 11 §11.50 needs the printed name, date and time, and meaning to be shown with the record, for as long as the record is kept (forever). IdP names change (marriage, typo fix), and accounts are removed. Offboarding is manual and no directory sync exists.
Example: A 2026 signature says "Weber"; in 2029 the IdP shows "Müller-Weber", and the old Principal no longer exists in the IdP.
Options: (a) snapshot the name, `iss`, `sub`, and time at signing in the immutable record and show it as is; (b) resolve at display time (drifts); (c) snapshot plus an optional "now known as" note.
Recommendation: (a).
Challenges: "printed name" taken live; "retention forever".

## Q10 [Impl] Strict mode is one global switch. Is that how a regulated site operates?
A single GXP_STRICT turns on everything for the whole instance. Real organisations mix GxP programmes with research, and applying signatures and fail-closed rules to exploratory work makes people leave the platform; leaving them off makes the regulated work unprotected. Also unaddressed: switching strict on in an instance that already holds unsigned merges, or switching it off.
Example: The company enables strict on 1 March. Merges from February have no signature. On 1 June someone sets strict off to speed a study, then back on in July.
Options: (a) per-namespace or per-repository regulated flag, with the global flag as default; (b) global only with the transition audited and one-way; (c) global flag and a documented "regulated from" timestamp on each repo.
Recommendation: (a) with (c); mode changes are audited, signed and not silent.
Challenges: "GXP_STRICT enables all strict controls together"; user story 1.

## Q11 [Impl] The strict flag is an environment variable. Is its change controlled?
An operator can redeploy with strict off, or with a changed reason-class list, and nothing in the product records it. The admin overview "shows" the state but is read-only. For a validated system, configuration is under change control and its history is part of the audit trail.
Example: A redeploy on Friday drops the e-signature action list from merge and settings to merge; on Monday privileged setting changes proceed unsigned.
Options: (a) write effective configuration to the audit trail at every instance start and on change (cheap, detectable); (b) move regulated policy into the database with signed changes; (c) deployment tooling only.
Recommendation: (a) now, (b) when policies become per-repo.
Challenges: Configuration via env; "strict mode state visible in the admin overview".

## Q12 [Impl] Fail-closed on lineage and everything: what record classes does an auditor really need?
The cross-cutting decision demands fail-closed lineage writes. Lineage is a derived provenance record from Jobs and Desktop Sessions. If immudb is down, a Job finishing a 6-hour run cannot record its lineage and either loses its result commit or fails.
Example: A 14-hour training Job completes at 03:00 during an immudb restart; the result commit is refused and the compute is wasted.
Options: (a) hold the finished outputs in the Workspace and retry the commit once audit recovers (no loss, delayed); (b) discard outputs (wasteful); (c) commit without lineage and flag.
Recommendation: (a), which relies on failed-job outputs staying in the Workspace, and state how long they are kept.
Challenges: "Lineage writes are also fail-closed under strict".

## Q13 [Domain] Is the reason quality controlled?
A reason is required on configured classes, but free text of "." or "fix" satisfies the gate. The plan also says the commit message is the default reason, and service principals have a pre-registered reason. Inspectors regard meaningless reasons as a data integrity observation.
Example: A user types "asdf" as the reason for deleting 600 files and the platform stores it as the justification.
Options: (a) minimum length plus pick-list categories plus free text (guides, still gameable); (b) mandatory change-control id from the QMS in strict mode; (c) accept free text, rely on review.
Recommendation: (a), with (b) selectable.
Challenges: "reason policy"; reason default from commit message.

## Q14 [Domain] A change-control id is "optional". Without validation it is decoration.
There is no QMS integration and no format. A typo creates an untraceable reference, and optional means regulated changes go unlinked. Annex 11 expects changes to be controlled, not just annotated.
Example: A Job rewrites a calibration table and the user enters "CC-2o26-114" (letter o); QA cannot find it in the QMS.
Options: (a) a configurable format (pattern) per namespace and required in strict for chosen classes; (b) lookup against the QMS through a webhook (heavy); (c) free text.
Recommendation: (a).
Challenges: "optional change-control id".

## Q15 [Domain] "Retention forever" and "no purge" meet legal reality
The decision is that nothing expires. Part 11 sets minimum retention, not an obligation to retain forever; GDPR, works councils and storage cost push the other way. Also a repository deletion (plan: cascade) removes data while claiming immutable records exist.
Example: A study archived after 15 years has 40 TB of outputs; the legal retention period was 15 years; the owner has no way to dispose of the data and no policy to declare.
Options: (a) retention as a per-namespace policy with legal-hold, defaulting to indefinite and with disposal performed only by a signed, audited action; (b) forever as decided; (c) time-based auto purge.
Recommendation: (a).
Challenges: "Retention forever"; out of scope "retention policies".

## Q16 [Domain] Is shipping "GxP strict" without backup and restore honest?
Annex 11 §7 and §16 expect data protection, backup, restore tested and business continuity. The owner defers backup until the deployment target is chosen, while strict mode and e-signatures are being built. A site validating against this product would immediately fail a supplier audit.
Example: A customer asks, "show the restore test for audit, signatures and Postgres". The answer is "not provided".
Options: (a) make "backup configured and last restore tested" a precondition surfaced in the admin overview and a startup warning under strict; (b) make it a hard refusal to start in strict; (c) declare it customer-side and document the responsibilities.
Recommendation: (a) now, (b) once a deployment target exists.
Challenges: "backup/restore deferred"; GXP-R-061/063.

## Q17 [Impl] What does "integrity verification of regulated records" check across stores?
Story 12 asks for verification that records are complete. Records are spread across immudb (audit), PostgreSQL (signatures, authz, lineage), oxen (data) and the shared filesystem (outputs). There is no cross-store manifest or reference check, and only one store has proofs.
Example: A signature row references merge commit M4, but the audit event for it is missing and oxen has M4 only on a branch deleted last week.
Options: (a) a verification job that cross-checks signature rows against audit events and oxen commit existence, producing a report (practical); (b) per-store checks only; (c) manual QA.
Recommendation: (a), scheduled and auditable.
Challenges: GXP-R-063 left open; "verify integrity of regulated records".

## Q18 [Domain] Who is the reviewer in escalation (GXP-R-058) if there is no separate approver?
The escalation requirement is open: thresholds, recipients and an offboarded-reviewer fallback. With the merger signing, nobody is "pending review"; either the escalation concept is empty or it quietly reintroduces a reviewer role. All notification categories are on by default, which would flood the same people.
Example: A merge waits for the `maintain` person, who is on leave for 3 weeks; no one is designated and no escalation fires.
Options: (a) drop GXP-R-058 for v1 and document; (b) a lightweight "requested reviewer" with deadlines and escalation to the namespace owner; (c) full approval workflow (out of scope).
Recommendation: (a) now, and remove the contradictory reviewer language from the plan.
Challenges: "Reviewer escalation undecided"; "no separate approver".

## Q19 [Impl] Which session settings are validated values in strict mode?
The idle timeout is shipped but defaults to off; the plan proposed that strict refuse to start with it off, and the absolute lifetime defaults to 8 hours. Annex 11 and Part 11 controls for unattended terminals need a defined value. PATs have their own lifetime and can mutate without any idle rule.
Example: A scientist leaves a laptop unlocked in a lab with an 8-hour session and no idle timeout; a colleague merges data under their name.
Options: (a) strict requires idle <= 15 min and absolute <= 8 h and refuses to start otherwise; (b) site-configured, documented; (c) defaults only.
Recommendation: (a), plus a maximum PAT lifetime in strict.
Challenges: "SESSION_IDLE_SEC default 0"; GXP-R-005.

## Q20 [Impl] PATs and service principals cannot sign. What happens to automated and CLI merges?
Signatures need an interactive session; PATs cannot sign. The CLI uses PATs, and the cross-cutting goal says web, CLI and API behave identically. Under strict, either CLI merges are impossible (parity broken) or a signature obtained in the web is reused (reuse of a credential).
Example: A scientist's pipeline does `merge` through the CLI nightly; in strict it will be refused, so they start doing merges locally and pushing the result.
Options: (a) CLI merges initiate a browser/device step-up that completes the signature (parity, more work); (b) merging only in the web in strict; (c) service principal merges are exempt with a registered reason (loophole).
Recommendation: (a), and (b) as the fallback; no exemption for service principals on signed actions.
Challenges: Cross-cutting parity; "PAT cannot satisfy interactive e-sig".

## Q21 [Impl] Break-glass and site-admin bypass in strict mode
The system has an audited break-glass path and a site-admin bypass of normal checks. Under strict these are the cheapest way around signatures, reasons and the maintain gate. The plan only says "tighten in strict mode".
Example: A bootstrap admin merges into a regulated repository using bypass, with a reason typed in 2 seconds, and no signature.
Options: (a) bypass disabled in strict for signed actions; admins must hold a role and sign; (b) allowed with mandatory reason and instant alert to QA; (c) as is.
Recommendation: (a), with (b) for non-signed administrative recovery.
Challenges: GXP-R-007 "tighten in strict mode" without a decision.

## Q22 [Domain] Session recording is optional even in strict. What does that mean for work done in Desktop Sessions?
Regulated analysis may occur inside a Desktop Session: files edited and results produced without any BFF call, until a commit. ALCOA "attributable and original" covers the process that produced the data. Optional recording means an unrecorded manipulation step leading to an "Approved" commit.
Example: An analyst, in a Desktop Session, hand-edits a spreadsheet to exclude 5 outliers and commits the cleaned file; the audit shows a commit but nothing about the edit.
Options: (a) recording or file-level change capture mandatory for sessions tied to regulated repos in strict; (b) optional, with a risk statement in the validation docs; (c) disallow Desktop Sessions for regulated repos.
Recommendation: (a) at least for regulated repositories.
Challenges: "session recording optional even under strict".

## Q23 [Impl] Commit ids are non-cryptographic. Is a signature bound to them strong evidence?
Oxen commit ids use a fast non-cryptographic hash; the owner chose SHA-256 as the authoritative digest but the signature binding still says "version id". A deliberate collision is unlikely but a design-level evidence statement should not rest on XXH3. Computing SHA-256 over a multi-terabyte tree at merge time is also costly.
Example: The signature binds commit id C9 for a 3 TB repository; an inspector asks for the SHA-256 evidence and nothing was computed at signing time.
Options: (a) compute a SHA-256 manifest (per-file digest list, itself hashed) at signature time, incrementally cached per commit (strong, work to do); (b) bind the XXH3 id only and state this limit; (c) sample files.
Recommendation: (a), computed asynchronously but stored before the signature is deemed final.
Challenges: "SHA-256 authoritative digest" vs binding on version ids.

## Q24 [Domain] Does the product help satisfy legibility and "accurate and complete copies"?
Part 11 §11.10(b) requires records to be available in human-readable and electronic form for inspection. The plan promises export of events, but the signature manifestation and its link to the merged data need an inspector-facing rendering.
Example: An FDA inspector asks for "all approvals of dataset X in 2026 with who, when and meaning" in a PDF they can take away.
Options: (a) a signed-record report per repository (PDF and machine-readable) generated by the platform; (b) the audit export only; (c) QA builds reports outside.
Recommendation: (a).
Challenges: Missing; Part 11 §11.10(b) mapping is partial.

## Q25 [Domain] External IdP controls are part of the compliance story. Who owns them?
With manual offboarding, no SCIM and an IdP the platform does not control, the uniqueness of identity, password policy, MFA and the timeliness of account removal are all outside the product, yet the e-signature rests on them. A departed employee remains a valid signer until an admin acts on a ticket.
Example: A contractor's IdP account is disabled on Friday but the admin only revokes on Wednesday; the existing Session keeps working for 4 more days within its lifetime.
Options: (a) document IdP requirements as a deployment precondition and check what can be checked (back-channel logout, token introspection per use); (b) require periodic reconciliation of Principals against the IdP, reported to QA; (c) accept.
Recommendation: (a) and (b).
Challenges: "manual offboarding only"; GXP-R-001/006.

## Q26 [Impl] How is the validated state of a release kept, given a derived search index, N instances and custom verifiers?
The system will be validated at a release; with a derived search engine, a homemade audit verifier and a reconciler, every upgrade needs an impact assessment. Tests are black-box at the HTTP boundary against containers. The strategy lacks a way to map each GXP-R requirement to evidence and to produce it per release.
Example: A minor upgrade of the PostgreSQL driver changes timestamp handling; no test traces to GXP-R-032.
Options: (a) a traceability matrix generated from tagged tests (requirement id in the test name) as a release artefact; (b) manual matrix in the QMS; (c) rely on e2e.
Recommendation: (a), with the release artefact stored alongside the audit trail.
Challenges: "CSV templates out of scope"; test decisions.

## Decisions log
| Q | Answer | Date |
| --- | --- | --- |
| Q1 | Inherited: no self-signing in GxP namespaces (00 Q9) | answered |
| Q2 | One meaning (Approved) in v1; meaning stored as field; configurable list later | answered |
| Q3 | Inherited: id_token always verified | answered |
| Q4 | IdP must assert auth method + max age (acr/amr/auth_time) else refuse; IdP is documented validated boundary | answered |
| Q5 | Bind source head, target head, merge-result content digest; refuse if any moved | answered |
| Q6 | 00 Q10 behaviour plus block new Pins on revoked commits (always) | answered |
| Q7 | Revocation is a signed action (reason, step-up) by signer or QA role; notifies Owners; maintainer self-revoke alerts QA | answered |
| Q8 | Full signature record in immudb; Postgres index only | answered |
| Q9 | Snapshot printed name, iss, sub, time at signing; optional 'now known as' note | answered |
| Q10 | STRICT IS NO LONGER A SWITCH: always on. Per-repo regulated-flag idea superseded; consider whether research repos need exemption (open) | answered |
| Q11 | Effective regulated configuration written to audit at each start/change; signed policy changes when per-repo | answered |
| Q12 | Hold outputs, lineage and everything in the Workspace until audit recovers; define held-output retention | answered |
| Q13 | Min length + pick-list category + free text; QMS change-control id mandatory for chosen classes | answered |
| Q14 | Configurable per-namespace pattern; required for chosen classes; default-on for destructive/privileged actions | answered |
| Q15 | Inherited: legal-retention stance (00 Q8) | answered |
| Q16 | Hard refusal to start without backup configured and restore tested, now (conflicts with 'backup deferred' — backup must be built) | answered |
| Q17 | Scheduled cross-store verification; report-only, never auto-deletes/repairs (owner: 'don't delete anything') | answered |
| Q18 | Owner asked whether non-maintainers can merge: any eligible maintainer (≥2 per repo, per 02 Q1) can; Owner can assign others (audited); no auto-escalation v1 — owner to confirm | answered |
| Q19 | Idle 15 min / absolute 8 h mandatory; refuse start if looser | answered |
| Q20 | Inherited: no SPs; CLI via device-flow step-up | answered |
| Q21 | Inherited: no break-glass | answered |
| Q22 | Inherited: recording mandatory for GxP-touching Sessions (00 Q22) | answered |
| Q23 | SHA-256 manifest at signature time, incrementally cached, stored before signature final | answered |
| Q24 | Platform-generated signed-record report per repo (PDF + machine-readable) | answered |
| Q25 | Covered by 01 Q1/Q2 (directory sync + live check) and 02 Q12 | answered |
| Q26 | Requirement id in test names; generated traceability matrix as release artifact stored with audit trail | answered |

---

# Known Issues and Conflicts

## Recording and compensating controls
- **Q22 inherited 00 Q22 (recording mandatory for GxP-touching Sessions), but 10-sessions Q4 reversed it: recording never**: The spec follows the global decision (no desktop recording). REGULATORY RISK: no primary capture of desktop work. Compensating controls are single RW session per Workspace and off-box auditd (system-level, not application). Validation strategy must rely on these controls.

## Open escalation and reviewer decisions
- **Q10 (possible exemption of research repos from always-on strict)**: PENDING. If research repositories are exempt, need a clear flag and enforcement boundary.
- **Q18 (no auto-escalation, escalation thresholds/recipients/offboarded-reviewer fallback not confirmed by owner)**: BLOCKER for ready-for-agent status. Without defined escalation, no notification fires when a reviewer is unavailable. Relates to 14 (Notifications) Q4 (no auto-escalation, reassignment only).

## Held output and fail-closed interactions
- **Q12 (held-output retention undefined)**: DEFERRED. When audit is down and a Job finishes, output stays in Workspace in "finalizing" state. How long outputs are retained is not set. Interacts with 08 Q2 (Workspace transient, loss risk stated) and 09 Q9 (finalizing visible state).
- **Q3/00 Q3 (absolute fail-closed, no protective exemption) combined with Q12 holds**: Documented availability risk. If immudb is down, work stops; if it recovers slowly, held outputs accumulate. Sizing and capacity planning needed.

## Signature record storage and verification
- **Q8 (full signature record in immudb, Postgres index only)**: Impacts 03 (Audit). The signature manifestation (name, time, meaning, record hash) is stored in immudb, not Postgres. 03 must carry the record size and verification proofs. Postgres signature table becomes a non-authoritative query index.

## Dependency on two-merger rule
- **Q18 (any eligible maintainer can merge, at least two per repo)**: Relies on 02 Q1 (forbid self-merge everywhere). Small teams with one maintainer cannot merge until a second is assigned. Review gate is unmeetable without two mergers. Impacts all GxP repositories.

## Backup conflicts and overrides
- **Q16 (backup/restore is a hard start gate) conflicts with earlier "backup deferred" stance**: OVERRODE the deferral. Backup and restore must now be built and tested before the first regulated start. Impacts 16 Q2 (Operations), 08 Q2 (interim Workspace upper backup).

## Lease renewal audit
- **Q18 (lease renewals audited per renewal, no aggregation)**: RESOLVED in authentication round 6 S1 – lease renewals have Intent/Outcome per renewal, no exemption. CONSEQUENCE: high audit event volume. Capacity-plan immudb for lease renewal load (every few seconds per active Workspace/Job). Interacts with 08 Q18 (same question, same answer).

## Cross-module verification and integrity
- **Q17 (report-only verification, never auto-deletes or repairs)**: Consistent with 05 Q22 (no purge in product). Scheduled cross-store verification (signatures vs audit vs oxen) raises alerts but does not fix data. Manual intervention required.

# Impact on Other Specs

## Blocks or dependencies
- **Blocks 01 (Authentication)**: Signature requires MFA evidence (Q4, Q6). IdP must assert acr/amr or signing is refused. IdP baseline check (authentication Q45, T6) is a GxP-compliance validation requirement.
- **Blocks 02 (Authorization)**: Two-merger rule (Q18 via 02 Q1) is a precondition for the review gate. Self-merge is forbidden in GxP namespaces.
- **Blocks 04 (Audit)**: Signature records stored in immudb (Q8) require audit module to handle larger record sizes and provide verification proofs.
- **Blocks 05 (Repositories)**: Merge signer must differ from author (inherited from 02 Q1). Immutable release records (Q23 via 05 Q23) support GxP pinning.
- **Blocks 08 (Workspaces)**: Automated Job commits are never signed (Q7 via 08 Q7); merge to main needs a human signature. Lease renewals are audited per renewal (Q18 resolved).
- **Blocks 09 (Jobs)**: Jobs never sign (Q7). Auto-merge removed (09 Q6); result stays on safe branch until human merges with signature.
- **Blocks 16 (Operations)**: Backup/restore as hard start gate (Q16) is now mandatory before regulated use. NTP-synced server clock with 1s drift alert (authentication R5) is an operational requirement.

## Depends on
- **Depends on 01 (Authentication)**: Step-up (Q4, Q6), fresh authentication per signing action, IdP MFA evidence, and signature evidence storage (authentication S6).
- **Depends on 03 (Audit)**: Fail-closed audit (Q3), held outputs on audit outage (Q12), integrity verification (Q17), and signature record storage in immudb (Q8).
- **Depends on 04 (Repositories)**: SHA-256 manifest at signature time (Q23 via 05 Q23) and merge head binding (Q5 via 05 Q14).

## Cross-cutting impacts
- **00 (Cross-cutting)**: GxP strict is always on (Q10), not a toggle. Research repo exemption is open. Absolute fail-closed (Q3/00 Q3) applies everywhere with lease renewal as the only counted exception (authentication S1 resolved it as strict).
- **03 (Audit)**: Signature records in immudb (Q8); event volume from lease renewals (Q18); integrity verification (Q17); held-output retention (Q12).
- **10 (Sessions)**: Recording decision overridden (Q22); compensating controls (single RW session, off-box auditd) must be documented in validation pack.
- **14 (Notifications)**: Reviewer escalation thresholds and recipients (Q18 PENDING) must be defined in Notifications module.

