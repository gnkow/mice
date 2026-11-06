Status: ready-for-agent (re-grilled 2026-11-05; the "Re-grilling decisions" section supersedes earlier decisions and the Open Questions below where they conflict)
Blocked on: nothing. Former blockers closed: escalation (Q18, replaced by the approver role), Q22 (recording never, accepted risk), Q10 (no exemption).

# 04 — GxP compliance (PLAT-GXP)

## Problem Statement

Regulated teams need Part 11 / Annex 11 oriented product controls on top of auth and audit: strict mode, reasons, e-signatures, and integrity evidence.

## Solution

Strict mode is always on (not a switch, no exemption). It enforces fail-closed audit, required reasons and change-control ids on defined mutation classes, and e-signatures on merges into validated branches. The default branch of every repository is validated from creation and starts empty; content arrives only through signed merges. An `approver` (a namespace/repository role, not necessarily a manager) who did not author any commit in the merged range signs the merge with meaning "Approved" (stored as a field). Commits carry a QC status (None, QC Marked, QC Passed, QC Failed) that is a property of the commit and identical on every branch.

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
15. As an auditor, I want every modified entity to keep an append-only version history of its successive states, separate from the audit trail of who and why, so that I can reconstruct what the entity looked like at any point.

## Implementation Decisions

- Strict mode is permanently on and enables: fail-closed audit for all mutations, reason policy, e-signature enforcement. No per-repo exemption.
- E-signature scope v1: every merge into a validated branch. The default branch is validated from creation; other branches opt in. Marking or unmarking a validated branch is a signed, reasoned action. Merges into non-validated branches need no signature and inherit commit QC status.
- Signer is the `approver` role (assignable by Owner, audited). The signer must not have authored or co-authored any commit in the merged range. One approver suffices. There are no minimum-approver, onboarding or offboarding rules: a merge request stays unapproved until an eligible approver exists. No auto-escalation.
- Nobody (including Owners and site admins) commits, force-pushes or deletes a validated branch directly. The CLI can open merge requests; signing happens only through browser step-up. No PATs or service principals exist, and automation cannot approve.
- Re-authentication through AUTH step-up; session cookie alone is insufficient. The ID token is always verified (JWKS, iss, aud, auth_time age); the IdP must assert acr/amr/auth_time or signing is refused; startup fails if the IdP lacks the capability; ADR 0001 is amended.
- Signature binds source head, target head and merge-result SHA-256 manifest digest (manifest stored before the signature is final). Commit ids are informational. A merge request goes stale if the target moves; the author re-syncs and approval starts over.
- Commit QC status: None, QC Marked (merge request for approval open), QC Passed (after signed merge), QC Failed (after revocation). Status is per commit and branch-invariant. Any approver can revoke individual commits, several, or all commits of a signature, with reason and step-up, and notifying the Owners and the original signer; revoker independence is not required. Revoking before the merge blocks the merge. Failed returns to Passed only through a new signature. No data is removed; revocation does not propagate between commits of a signature. A merge commit keeps its own status; revoking the signature fails it. The UI warns on merge commits and descendants that contain QC Failed commits.
- Reasons (min length, pick-list category, free text) and the change-control id (per-namespace pattern) are required for: changes or deletions of existing records on validated branches, destructive actions, privileged settings, revocation. The change-control id is also required on merge signatures. New data (new files, commits on non-validated branches) needs neither.
- Entity version history is distinct from the Audit trail. Audit records who changed what, when, why and with what result (immudb). Entity version history records the successive states of each mutable domain entity so a prior state can be reconstructed without reading audit. Every modification of an entity appends a new version; prior versions are never edited or deleted. Historic views live on the entity (not only on the Audit page). Creates open the first version; updates and deletes close the prior version and open the next (delete may close without a successor). Already versioned today: oxen repository data, principal names, RBAC roles and permissions (plus permission snapshots), metadata revisions, access-flag history. Remaining mutable BFF entities (namespace settings, memberships, repository collaborators, custom roles, and any other mutable store) must gain the same property; an inventory ticket closes gaps or records an explicit exemption with rationale.
- Audit order is intent, then effect, then outcome. Failed outcomes are audited. A reconciliation job flags intents without outcome (it writes its own audit record, never repairs).
- When audit is unavailable all mutations are refused and reads continue. There is no outbox and no held output; users see "audit unavailable, nothing was saved" and the client keeps local work. A health probe and operator alert on audit degradation are required; a single immudb instance is unsupported for production.
- The full signature record lives in immudb (append-only, with `esign.*` audit events); PostgreSQL holds only an index.
- Recording of desktop Sessions never happens (global decision); accepted risk, compensating controls (single RW session per Workspace, off-box auditd) are stated in the validation strategy.
- Backup/restore integrity (GXP-R-061/063): backup target configured and reachable is a start gate; a restore test is required before the first regulated action (first validated-branch merge or signature). Target is Kubernetes (Compose dev-only).
- No break-glass in v1.
- Releases carry a signed release manifest (versions and digests of IdP configuration, search index, custom verifiers) verified at start; a mismatch is audited and shown in the admin overview.

## Testing Decisions

- HTTP tests: merge without signature is refused in strict mode; re-authentication required; revoke creates a linked record.
- Prior art: audit tests and e-sign step-up flow in Playwright.

## Out of Scope

CSV templates, separate approver workflow, PR-like review.

## Further Notes

The signer must not have authored any commit in the merged range, so an approver cannot approve their own work; if they are the only approver the request waits. The former "at least two eligible maintainers per repo" rule is dropped. Template content enters a new repository through a merge request into the empty default branch, signed like any other merge (no unsigned seed).

Open grilling questions: see questions.md in this folder (superseded where "Re-grilling decisions" conflict).

## Re-grilling decisions (2026-11-05, supersede conflicting items below)

- Signature only for merges into validated branches; default branch validated from creation (empty); approver role; signer not an author in the range; one approver suffices; no min-approver/escalation/offboarding rules (supersedes Q1, Q18).
- Signature binds content digest (manifest); commit ids informational (Q5, Q23).
- Commit QC status None / QC Marked / QC Passed / QC Failed, per commit, branch-invariant; revoke by any approver on commits or whole signature; Failed to Passed via new signature; no propagation; merge before revocation is blocked (supersedes Q6, Q7).
- Reasons only for changes/deletions of existing records on validated branches, destructive actions, privileged settings, revocation; change-control id on those plus merge signatures (supersedes Q13, Q14).
- Entity version history ≠ Audit trail; every modified entity is versioned on change with an entity-local historic view (new requirement, story 15).
- Intent, effect, outcome audit order; failed outcomes audited; audit outage blocks all mutations, reads continue, no outbox, no held output (supersedes Q12).
- No direct commits to validated branches by anyone; CLI opens merge requests, signs via browser step-up; no PATs/SPs (Q20).
- No break-glass (Q21). No research-repo exemption (Q10). ID token verified and IdP capability checked at start; ADR 0001 amended (Q3, Q4).
- Backup configured at start, restore tested before first regulated action (refines Q16).
- Q22 closed as accepted risk with compensating controls. Retention (Q15) and principal snapshot (Q9) covered by other specs; release manifest signed and verified at start (Q26).

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

- Q22: 10-sessions Q4 reversed recording to never. Accepted risk; the validation strategy relies on compensating controls (single rw session per Workspace, off-box auditd). ACCEPTED.
- Q10: no research-repo exemption. CLOSED.
- Q18: replaced by the approver role; no escalation in v1. CLOSED.
- Q16 conflicts with the earlier "backup deferred" stance; backup target is needed at start and restore must be tested before the first regulated action. OVERRODE.
- Q12: held output removed; mutations are refused during audit outage. CLOSED.
- Q8 moves the signature record to immudb; 03-audit must carry the record size and verification proofs.
- 02 Q1 (self-merge forbidden everywhere, at least two mergers per repo) conflicts with the approver model; 02 must be aligned (signer not an author in range, one approver).
- Q3/00 Q3 absolute fail-closed (no protective exemption) is a documented availability risk; mitigated by the required audit health probe, alert and non-single-instance production deployment.
- QC status per commit and branch-invariant: 05 (Repositories) must expose it and the merge-request QC Marked state.
- 01-authentication: ADR 0001 must be amended (ID token always verified).
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

## Resolved escalation and reviewer decisions
- **Q10**: CLOSED. No research-repo exemption.
- **Q18**: CLOSED. The approver role replaces escalation; unapproved merge requests simply wait. 14 (Notifications) needs no escalation thresholds.

## Fail-closed interactions
- **Q12 superseded**: no held output; mutations are refused during audit outage and the client keeps local work. 08 Q2 and 09 Q9 ("finalizing" state) must be aligned.
- **Q3/00 Q3 (absolute fail-closed)**: availability risk. If immudb is down, all writes stop. Mitigated by a required health probe and alert and no single-instance production deployment.

## Signature record storage and verification
- **Q8 (full signature record in immudb, Postgres index only)**: Impacts 03 (Audit). The signature manifestation (name, time, meaning, record hash) is stored in immudb, not Postgres. 03 must carry the record size and verification proofs. Postgres signature table becomes a non-authoritative query index.

## Approver model and 02 alignment
- **Approver role replaces the two-merger rule**: one approver suffices; the signer must not have authored a commit in the range. 02 Q1 (self-merge forbidden, two mergers per repo) must be aligned.

## Backup conflicts and overrides
- **Q16 (backup/restore is a hard start gate) conflicts with earlier "backup deferred" stance**: OVERRODE the deferral. Backup and restore must now be built and tested before the first regulated start. Impacts 16 Q2 (Operations), 08 Q2 (interim Workspace upper backup).

## Lease renewal audit
- **Q18 (lease renewals audited per renewal, no aggregation)**: RESOLVED in authentication round 6 S1 – lease renewals have Intent/Outcome per renewal, no exemption. CONSEQUENCE: high audit event volume. Capacity-plan immudb for lease renewal load (every few seconds per active Workspace/Job). Interacts with 08 Q18 (same question, same answer).

## Cross-module verification and integrity
- **Q17 (report-only verification, never auto-deletes or repairs)**: Consistent with 05 Q22 (no purge in product). Scheduled cross-store verification (signatures vs audit vs oxen) raises alerts but does not fix data. Manual intervention required.

# Impact on Other Specs

## Blocks or dependencies
- **Blocks 01 (Authentication)**: Signature requires MFA evidence (Q4, Q6). IdP must assert acr/amr or signing is refused. IdP baseline check (authentication Q45, T6) is a GxP-compliance validation requirement.
- **Blocks 02 (Authorization)**: Two-merger rule (Q18 via 02 Q1) is a precondition for the review gate. Self-merge is forbidden in GxP namespaces. Mutable AuthZ entities (namespace settings, memberships, collaborators, custom roles) must carry entity version history (story 15), distinct from audit.
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

