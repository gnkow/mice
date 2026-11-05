Status: needs-info
Blocked on: the overlay-on-shared-filesystem spike (see 08), legal sign-off on the no-erasure stance (Q8).

# Cross-cutting decisions for the Mice platform respec

## Problem Statement

The sixteen plans were written against a JSON/JSONL/SQLite world and a single-instance assumption. ADR 0004 and 0005 replaced that with PostgreSQL, immudb and Novu, and the platform must now scale beyond one BFF instance. Operators, scientists and auditors need one consistent behaviour across epics, not sixteen plans that disagree.

## Solution

Treat the plans as intent only. Each epic gets a fresh spec (01-16) written as if unbuilt, and this spec holds the decisions that apply to all of them. ADRs 0001, 0002, 0004 and 0005 are truth; every JSON store, JSONL log, SQLite and `AUTH_DATA_DIR` reference in the plans is void.

## User Stories

1. As an operator, I want every epic to follow the same persistence model, so that I run one set of databases.
2. As an operator, I want to run more than one BFF instance, so that a single process is not a point of failure.
3. As an auditor, I want every mutation to be recorded before it takes effect, so that no change exists without a record.
4. As an auditor, I want an orphaned intent resolved to an outcome, so that I never see a mutation of unknown result.
5. As a scientist, I want identical behaviour from web, CLI and API, so that I can pick the tool that suits me.
6. As a compliance lead, I want GxP strict behaviour, always on, to be identical on every mutating surface, so that I can describe it once in validation documents.
7. As a developer, I want one test seam and real containers, so that tests reflect production.
8. As an instance admin, I want one place to revoke an identity everywhere, so that offboarding is complete.
9. As a repository owner, I want to rename a repository without losing its history in Mice, so that renames are safe.
10. As a security reviewer, I want egress and SSRF controls defined centrally, so that no epic invents its own.

## Implementation Decisions

- **Persistence:** PostgreSQL for relational state, immudb for audit, Novu (MongoDB, Redis) for notifications, a dedicated search engine for metadata search as a derived index rebuildable from PostgreSQL. A new ADR extends ADR 0004 to cover the search engine. No file or in-memory state for database-shaped data.
- **Multi-instance:** N BFF instances are a requirement. Any "single BFF" or `dataDirLock` assumption must be replaced by database-level coordination (leases, generation checks, advisory locks). Bulk tree state (workspace trees, job logs, checkouts) is placed on a shared RWX filesystem. Whether overlay mounts work on it is unresolved (see 08).
- **GxP strict:** always on; it is not a switch. Every mutation fails closed with 503 when its Intent event cannot be appended. No class is exempt and there is no protective-action exemption. Lineage writes are also fail-closed. Lease renewals are NOT exempt: every renewal has its own Intent/Outcome (auth round 6 S1).
- **Intent/outcome reconciliation:** an Intent with no Outcome is resolved by a reconciler that re-queries oxen and infers the result only when verifiable by content digest; otherwise the Outcome is "unknown", labelled as such in exports.
- **Dataset version capture:** for every mutation class the BFF records `{base, head}` on the audit event, using the commit id oxen returns where available, an optimistic base-verify elsewhere, and a lock only where oxen is not atomic.
- **Repository identity:** Mice gets a stable repository id independent of the `namespace/repo` name. AuthZ, favorites, metadata, lineage and audit references use it. Physical oxen repository names are static (keyed by the stable id); a rename changes only the BFF's persistence layer, keeps the id and every commit id, and is audited.
- **Offboarding:** admin revoke by `iss`+`sub` stays available, and back-channel logout (Sessions only) and directory-based revocation are supported. No SCIM provisioning.
- **Retention:** records are kept until deleted. No default expiry for logs, outputs, lineage or audit.
- **Notifications:** defaults follow criticality: action-required categories on (including email), informational in-app only or off.
- **Authorization naming:** "Stage" is the user-facing term for an Oxen workspace; authz actions use a `stage` resource directly; this is a new project, so there are no legacy names, aliases or migration.
- **SSRF:** URL import is disabled until allowlist, redirect re-validation, caps and provenance controls exist; any future fetch runs in a BFF-controlled, egress-restricted fetcher, never in oxen-server.
- **Digest:** SHA-256 is authoritative integrity evidence; oxen's XXH3-128 stays the oxen identifier.
- **Identity provider:** an external IdP is required in production; Keycloak is development-only.
- **Runners:** Kubernetes is the production target; Compose is development-only. Runners sit behind one interface in a separate runner service that holds the Docker socket or cluster credentials; the BFF never mounts them. Jobs use BFF-internal tokens; service principals do not exist.

## Testing Decisions

- A good test drives external behaviour only: HTTP requests in, responses and persisted effects out.
- Single seam: the BFF HTTP boundary, black-box, against the real containers (PostgreSQL, immudb, Novu, search engine). CLI and web get end-to-end tests only for behaviour that exists in those surfaces.
- Prior art: existing BFF API tests that already run on containers (ADR 0004) and the existing Playwright suite.
- Tests use unique ids and delete only their own rows; audit entries are filtered by unique ids.
- Multi-instance behaviour is tested by running at least two BFF instances against the same databases and filesystem.

## Out of Scope

- SCIM provisioning.
- Retention policies and automatic purging.
- Binary distribution of the CLI.

## Further Notes

Unresolved: overlay on shared filesystem; legal sign-off on retention. The reviewer escalation target (Q24) is closed: there is no escalation (see 04). The deployment target is decided (Kubernetes). Backup and restore is a hard start gate, not deferred.

Open grilling questions: see questions.md in this folder.

## Alignment with 04 (2026-11-05)

04 is the source of truth for GxP. Changes here:
- Q9/Q24 superseded: e-signature only for merges into validated branches (default branch validated from creation); the signer holds the `approver` role (not maintain), must not have authored or co-authored any commit in the merged range; one approver suffices; no escalation, no minimum-approver, onboarding or offboarding rules. "Merge plus maintain" and "no self-signing" are replaced by this author-exclusion rule.
- Q10 superseded: commit QC status None / QC Marked / QC Passed / QC Failed; any approver can revoke with reason and step-up.
- Q18 closed: ID token always verified (JWKS, iss, aud, auth_time age); the IdP must assert acr/amr/auth_time, startup fails otherwise; ADR 0001 is amended.
- Q3 refined: audit outage refuses all mutations, reads continue; no outbox, no held output; client keeps local work; health probe and alert required; single immudb unsupported in production. Audit order is intent, effect, outcome.
- Q22 closed: recording never; accepted risk with compensating controls.
- No break-glass, no research-repository exemption; nobody commits directly to a validated branch; no PATs or service principals (Q19 stays moot).
- Backup target configured at start; restore tested before the first regulated action. Signed release manifest verified at start.

## Decisions from grilling

Concurrency and coordination
- Fencing tokens are recorded in the tree and checked by every writer; Postgres is the source of truth (Q1).
- Each module keeps an in-process-state inventory as a release gate, plus a randomized two-instance test on every mutation route (Q2).
- Dataset version capture uses the oxen commit id, optimistic base-verify, and locks only where oxen is not atomic (Q6).
- One owner per fact: Postgres owns permissions and state, immudb what happened, oxen data, the filesystem files, the Postgres projection messages, search is derived. Derived stores are rebuilt from Postgres via one outbox, with a repair job per fact (Q26).

Audit and GxP
- Absolute fail-closed on Intent failure, risk documented, no protective-action exemption (Q3).
- All reads are audited (Q4); database time orders events, with record time and effect time stored separately (Q17).
- An Outcome is inferred only when verifiable by content digest, else "unknown", visible in exports (Q5).
- Every event carries a responsible human owner (Q19).
- Authored-by is separate from signed-by; no self-signing in GxP namespaces; meaning chosen and step-up applied at signing (Q9).
- Revocation lifts "approved" on dependent Pins, warns downstream lineage and notifies owners (Q10).
- Erasure is impossible; documented as the legal-retention stance (Q8).
- id_token signature is always verified; ADR 0001 is amended; strict values on by default (Q18).

Repositories and data
- Rename freezes the repository and verifies digest and commit chain (Q7); superseded by static physical names, rename only in the BFF (see Conflicts).
- Pin oxen by image digest, with contract tests per candidate version and controlled upgrade (Q27).
- SHA-256 is computed in the BFF upload stream, stored beside the Pin and verified on download and Job input; background verification covers other ingress (Q14).
- URL import is disabled until controls exist (Q15).
- Namespace schemas extend a shared instance-level base schema (Q21).
- Search hits are filtered through authorization, counts follow filtering, and Postgres full-text search is reconsidered before a separate engine (Q20).

Identity, naming and surfaces
- Back-channel logout and directory-based revocation are kept; the spec is fixed (Q11).
- Stage naming is used directly, with no aliases or migration (Q16).
- Notification defaults follow criticality (Q12).
- The CLI is pinned exactly and served from the BFF itself (Q25).
- No automatic retries (Q23); role-only reviewer gate, escalation unresolved (Q24).

Testing and parity
- Test-only fault-injection hooks sit at the HTTP boundary, with a crash-point list in the spec (Q13).
- A one-off parity checklist from code and tests is marked keep/change/drop by the owner (Q28).

## Conflicts and open risks

- Q8 (erasure impossible): conflicts with its own option analysis; legal sign-off needed. Blocker for Status.
- Q3 (absolute fail-closed) holds with no exception: 08 Q18 aggregation was dropped (auth round 6 S1). RESOLVED. Consequence: immudb outage stops Workspace work at lease expiry; size lease TTL and renewal rate accordingly.
- Q22 (recording mandatory in strict) is OVERRIDDEN by the global decision and 10 Q4: desktop sessions are never recorded; 04 closes it as accepted risk. Compensating controls are one read-write session per Workspace and off-box auditd.
- Q7 (copy-based rename with freeze) is superseded by 05 Q25: static physical names, rename only in the BFF. 05 Q3-Q6 are mostly moot.
- Q24: CLOSED by 04 (2026-11-05): the `approver` role signs; one approver suffices; no escalation, a merge request stays unapproved until an approver exists.
- Q23: no automatic retries, yet 09 Q9 retries the finalize Intent and 03 Q21 retries the Outcome inline; the spec must state these are bounded internal retries, not mutation retries.
- Q19 (service principals can never sign) is moot: service principals are removed (01 Q12, Q13); Jobs use BFF-internal tokens and automated commits are never signed (08 Q7).
- The overlay-on-shared-filesystem spike (08 Q1) is UNRESOLVED; Kubernetes is the production target (16 Q1) but Jobs on it are unsupported until the spike passes (09 Q11). Blocker for Status.
- Q15: URL import disabled; entry criteria for re-enabling are undefined (06 Q9).
- Q20: Postgres full-text search is the first attempt (16 Q25); a separate engine needs a new ADR.
- 16 Q2 and 04 Q16 make backup and restore a hard start gate; the former deferral is void.
- 16 Q21: DEFERRED supply-chain/SBOM gap must close before regulated use.
- 16 Q27: maintenance windows only; inferred outcomes remain possible after a crash.
- 04 Q10: CLOSED: no research-repository exemption; strict is always on.
- Q26: derived stores repaired via Postgres outbox; 04 Q17 verification is report-only and never repairs or deletes.

## Update from authentication review
- GxP requirements beat GDPR on conflict; no identity data is erasable; no IPs stored (auth R2, round 5). Legal sign-off on the no-erasure stance remains open.
- IdP is single and unchanging; iss+sub is never reused (auth Q29, S8).

---

# Open Questions


Status: the cross-cutting spec is `needs-info` (overlay on a shared filesystem unresolved; reviewer escalation closed by 04) and binds all sixteen module specs.
Biggest risks: N instances sharing disk state with no coordination design, fail-closed everywhere with no safe path for emergencies, an audit model whose "after" facts are inferred rather than observed, and retention-forever colliding with privacy law.
Every question carries an example, 2-4 options, a recommendation and the prior decision it challenges.

## Q1 [Impl] N BFF instances versus state that lives on a shared filesystem
The spec requires several BFF instances and puts workspace trees, job logs and checkouts on a shared RWX filesystem, replacing the single-process lock with "leases, generation checks, advisory locks". Database locks do not protect files: an instance that lost its lease can still write to the tree after a pause, and network filesystem caching means another instance may read stale directory entries. The relational state and the file state can therefore disagree, with no component that owns the truth.
Example: instance 1 holds the lease for Stage "rna-prep", stalls for 40 seconds in a garbage-collection pause; instance 2 takes the lease and starts a Job; instance 1 resumes and writes its state file into the same tree.
Options: (a) fencing tokens recorded in the tree and checked by every writer, with the database as source of truth; (b) route all operations on a given Stage to one owning instance (consistent hashing); (c) make the tree content-addressed and immutable per generation.
Recommendation: (a) now, since it is compatible with any instance count; consider (b) if the filesystem proves unreliable.
Challenges: "N BFF instances required"; "shared RWX filesystem"; replacement of the single-writer lock.

## Q2 [Impl] N instances versus in-process caches, queues and workers
The plans were written for one process and carry in-memory caches (authorization decisions, directory data), a notification worker, a verification timer, startup job-recovery and an Intent reconciler. The spec's multi-instance section only lists the lock and the leases. Everything else is a latent single-instance assumption that tests with one instance will never reveal.
Example: two instances each run the reconciler and each append an Outcome for the same orphaned Intent, producing two contradictory Outcome events for one change.
Options: (a) an inventory step: every module spec lists its in-process state and its coordination rule, reviewed as a release gate; (b) a two-instance test with randomised request routing for every mutation route; (c) rely on code review.
Recommendation: (a) and (b); the inventory is cheap and the test finds what the inventory misses.
Challenges: "Any single BFF or dataDirLock assumption must be replaced"; the shape of the testing decision.

## Q3 [Domain] Fail-closed for every mutation, including emergencies and lineage
`GXP_STRICT` returns 503 whenever an Intent cannot be appended, with no class exempt, and lineage writes join them. That is the correct default for a data change but not for actions that protect the system: revoking a compromised Principal, stopping a runaway Job, or terminating a Desktop Session exposing patient data. Lineage capture is derived, and blocking a user's job because lineage bookkeeping failed trades science for bookkeeping.
Example: immudb is down for 25 minutes; a scientist cannot stop a Job that is overwriting a shared output, and the admin cannot revoke a leaked PAT.
Options: (a) define an explicit small "protective action" class that may proceed with a durable deferred Intent in PostgreSQL, flagged for later append; (b) keep absolute fail-closed and accept the risk, documented; (c) split lineage out as best-effort with a repair queue.
Recommendation: (a) for protective actions, keeping lineage fail-closed only for lineage that is the primary record (merge, publish).
Challenges: "GXP_STRICT fail-closed for ALL mutations incl. lineage"; "no class is exempt".

## Q4 [Domain] Is a read an event? Fail-closed scope for non-mutating access
The decision is about mutations, but Part 11 and the data-integrity guidance care about access to records too, for example exports, downloads and Desktop Session access to unpublished data. The spec does not say which reads are audited, so each module author will decide for themselves. Over-auditing floods the trail; under-auditing leaves "who looked at the unblinded results" unanswerable.
Example: during an inspection the QA lead asks who downloaded the unblinded randomisation file; the trail has uploads but no downloads.
Options: (a) a platform-wide list of audited read classes (download, export, session access, signature view); (b) mutations only, reads via application logs; (c) all reads audited.
Recommendation: (a), written once in the cross-cutting spec.
Challenges: "every mutation recorded before it takes effect" as the only audit rule.

## Q5 [Domain] The reconciler infers an Outcome; is an inference an ALCOA record?
When an Intent has no Outcome, the reconciler re-queries oxen and decides what probably happened. ALCOA wants records to be attributable, original and accurate; an inferred Outcome is neither observed nor attributable to what actually ran, and it may be wrong when other writers touched the same repository after the crash. Auditors will want to know the difference between "known" and "inferred".
Example: user A's push crashes the BFF after oxen applied it. By the time the reconciler runs, user B has pushed more; the reconciler sees head H2 and cannot tell whether A's change is in H1.
Options: (a) Outcome events carry a confidence field (observed, inferred, unresolved) and unresolved ones require human resolution; (b) the reconciler only marks "unknown" and never guesses; (c) inference when it can be verified by content digest, otherwise unknown.
Recommendation: (c), with the inferred label always visible in exports.
Challenges: "reconciler re-queries oxen to infer outcome".

## Q6 [Impl] The extra read and lock around every mutation: latency, scope and races with other writers
For every mutation the BFF reads the dataset head before and after, holding a lock, and records base and head. This adds at least two oxen round trips to each write. A lock held on the BFF does not stop writers that bypass the BFF: the unauthenticated oxen port is published in the shipped development stack, and a Job's own commits go through other paths. With N instances the lock must also be distributed.
Example: a push of 10,000 files holds the repository lock for 4 minutes; 6 other writers to the same repository queue up; one instance crashes and its lock leaks.
Options: (a) lock with a lease and a fencing check, and treat head-after as "observed at time T, may include others"; (b) optimistic concurrency, record the base and verify the head chain after; (c) record only what oxen returns in its own response where it provides a commit id.
Recommendation: (c) wherever oxen returns it, (b) elsewhere, locks only for operations oxen cannot make atomic.
Challenges: "extra oxen read+lock before/after every mutation for dataset head".

## Q7 [Domain] The stable repo id and rename as copy plus delete
Renames are copy then delete done by the BFF, with Mice keeping the repository id. Oxen commit hashes may differ after a copy, so history that scientists cite (a commit identifier in a paper) may stop resolving, remote URLs in existing CLI clones break, and a failed delete leaves two live copies, one of which receives pushes. Storage doubles temporarily and the operation is not atomic.
Example: renaming "oncology/imaging-v1" (800 GB) to "oncology/imaging" copies for 3 hours; a scientist pushes to the old name at hour 2 and that push never reaches the new copy.
Options: (a) rename only when no writers are active (the repository is frozen) and verify equal content digest and commit chain before deleting; (b) never rename, offer alias names mapped to a stable id; (c) copy-forward with the old name retained as a read-only redirect forever.
Recommendation: (b) with the alias if oxen cannot rename natively; (a) if an exact copy of history is demonstrable.
Challenges: "rename = copy+delete at BFF with stable repo id".

## Q8 [Domain] Retention forever versus erasure rights and personal data in immutable stores
The spec keeps every log, output, lineage record and audit event with no default expiry, and the audit trail is tamper-evident by design. Audit events, lineage and search metadata contain names, emails, free text, filenames and possibly patient-related data. GDPR erasure and storage-limitation duties still apply to a pharmaceutical customer, and immudb cannot delete.
Example: a former employee submits an erasure request; their name and email appear in 42,000 audit events, 300 metadata records and 11 job logs.
Options: (a) store pseudonymous Principal keys in the trail and the readable identity in a deletable PostgreSQL table, so erasure removes the link; (b) accept the conflict and rely on the legal retention exception, documented; (c) retention policies after all, with legal hold.
Recommendation: (a), since it satisfies both without needing the owner to change the retention stance.
Challenges: "retention forever"; "no default expiry for logs, outputs, lineage or audit".

## Q9 [Domain] The e-signature is a merge by a maintain holder, with no approver
The platform's electronic signature is the maintain user signing at merge, with no separate approver, and the review gate is "Merge plus maintain". Part 11 11.50 requires the printed name, date and time and the meaning of the signature (review, approval, responsibility), and 11.200 expects two distinct components for the signature. A merge by the author themselves is not a review.
Example: Dr. Haas commits the analysis, holds maintain on the repository and merges her own change; the record shows "signed: Haas", with the meaning field empty.
Options: (a) separate "authored by" from "signed by", forbid self-signing for GxP namespaces, and require a meaning chosen at signing; (b) accept the model for non-GxP and add an approver role for GxP; (c) keep as is.
Recommendation: (a) with step-up re-authentication at signing for both components.
Challenges: "e-sig = maintain user signs at merge, no separate approver"; "Merge+maintain is the review gate".

## Q10 [Domain] Signature revocation is only an annotation
Revoking a signature adds an annotation and leaves the signed state intact. If the signer's account was compromised, or the signature was obtained under a mistake, downstream consumers (Jobs, Pins, exports) keep treating the merged data as approved. The record is intact but the effect is not undone.
Example: a signature on dataset v3 is revoked on Tuesday as obtained under a stolen Session; a Job started Wednesday still pins v3 as "approved input".
Options: (a) a revocation state that lifts the "approved" status on dependent Pins and warns on downstream lineage; (b) annotation only, with a mandatory notification to owners of Jobs that used it; (c) annotation plus a forced follow-up review task.
Recommendation: (a) with the notification of (b).
Challenges: "signature revocation annotation-only".

## Q11 [Domain] Offboarding: the spec says manual only, but the code already syncs the directory
The decision is "manual admin revoke, no SCIM, no directory sync", but the codebase contains an offboarding flow with a directory-sync cause, back-channel logout and suspension of service principals. Either the code is a feature to retain, or it is dead scope the specs do not mention. Meanwhile, a leaver's access lasts as long as someone remembers to revoke it, which Annex 11 treats as a control weakness.
Example: an employee is terminated at 09:00; HR disables the IdP account but Mice's PAT stays valid for the 90 days until it expires.
Options: (a) keep back-channel logout and directory-based revocation as supported mechanisms and fix the spec; (b) remove them to match the spec; (c) require PAT validity to depend on a periodic IdP check.
Recommendation: (a) or (c); an offboarding path that depends on a person remembering is the weakest option.
Challenges: "manual offboarding only (no SCIM)"; "treat plans as intent only" discarding verified code.

## Q12 [Domain] All notification categories on by default
Every catalog category is on by default, including email where configured. For scientists this is alert fatigue within a week, with the effect that the few notices that matter (signature requests, strict-mode failures, quota alerts) are filtered out by habit. For privacy, email can carry names and dataset titles outside the system.
Example: 90 Job completions a day each generate an inbox item and an email; by Friday a scientist has a mail rule that sends every Mice email to trash, including a signature request.
Options: (a) defaults per category chosen by criticality (action-required on, informational off), with email only for action-required; (b) all on as decided plus digests; (c) all off.
Recommendation: (a).
Challenges: "all notification categories on by default".

## Q13 [Impl] Testing only at the HTTP boundary cannot reach the crash and timing cases the platform is built around
The single seam is black-box HTTP against real containers. The most important claims, Intent before effect, Outcome after crash, lease fencing and fail-closed under outage, depend on faults at specific moments, which an HTTP client cannot trigger. Parallel tests sharing audit entries that can never be deleted also make count-based claims weak.
Example: nothing can prove "the BFF crashed after oxen applied the push but before Outcome, and the reconciler resolved it" because a test cannot pick that instant.
Options: (a) add fault-injection hooks reachable through the same boundary in a test-only build, with a short list of crash points; (b) separate in-process tests for the reconciler; (c) manual game days.
Recommendation: (a) with the crash-point list written into the spec.
Challenges: "Single seam: the BFF HTTP boundary, black-box".

## Q14 [Domain] SHA-256 as evidence while oxen identifies content with a non-cryptographic hash
SHA-256 is declared authoritative integrity evidence, while oxen keeps XXH3-128 as its identifier, which is fast but not collision resistant against a malicious writer. Who computes the SHA-256, when, over which bytes, and whether it is checked again at read, are not stated. Computing it requires reading every byte the BFF did not stream.
Example: a user with write access crafts two files with the same XXH3-128; oxen treats them as one, and the SHA-256 recorded at upload no longer matches what a later download returns.
Options: (a) compute at upload in the BFF stream, store beside the Pin and verify on download and in the Job's input check; (b) compute lazily in a background verification job; (c) trust oxen identity within the platform.
Recommendation: (a) for uploads through the BFF, (b) for data that arrives otherwise.
Challenges: "SHA-256 authoritative digest" versus oxen identity.

## Q15 [Impl] URL import through the BFF fetcher: SSRF is only part of the problem
The egress-restricted fetcher handles SSRF but the spec does not cover redirects, DNS rebinding, response size and time limits, content type, or recording the source for provenance. An imported file's origin is part of its record under ALCOA: where did this data come from, and was it the same later?
Example: an import URL redirects to a cloud metadata address, or a 200 GB download from a slow server holds a worker for 9 hours.
Options: (a) allowlist of hosts per namespace, redirects re-validated, size and time caps, and the final URL plus digest recorded in the Intent; (b) a denylist of private ranges only; (c) disable URL import until the controls exist.
Recommendation: (a), and (c) until it is met.
Challenges: "URL import enabled via BFF egress-restricted fetcher".

## Q16 [Domain] Stage renaming and the authorization migration, when "no data to preserve" is no longer true
Authz actions move to a stage resource with aliases and custom-role migration. Custom roles written against the old action names exist in any used environment, and audit events refer to the old names, which cannot be rewritten. Aliases solve the live path but audit readers and exports must explain two vocabularies for years.
Example: a custom role "Data steward" has `workspace.delete`; after migration it silently gains or loses a permission when aliases are mapped imprecisely.
Options: (a) one-to-one mapping verified by a before-and-after effective-permission comparison per role, with the diff in the audit trail; (b) manual re-creation of roles by owners; (c) keep old action names internally and rename only the labels.
Recommendation: (c) first (it costs nothing and is reversible), then (a) when the real rename is needed.
Challenges: "stage naming/authz migration".

## Q17 [Domain] Which clock is the clock of record across five stores?
Events are stamped by the BFF, PostgreSQL, immudb, oxen and Novu. Under N instances and a reconciler that writes Outcomes later, the order of events in the trail may not equal the order of effects. An auditor reconstructing "what happened first" will rely on timestamps.
Example: an Intent is stamped 10:00:01 by instance 1, an Outcome inferred at 10:07 by the reconciler; a revocation at 10:03 sits between them and it is unclear whether the mutation was valid when applied.
Options: (a) the database time for all event ordering, the effect time recorded separately from the record time; (b) wall clocks with NTP; (c) sequence numbers only.
Recommendation: (a), and store both the effect time (when it occurred as far as known) and the record time.
Challenges: Part of "contemporaneous" in ALCOA+ with no defined clock.

## Q18 [Impl] External IdP only, and the ID token signature that ADR 0001 says is not verified
ADR 0001 accepts the id_token without signature verification as it arrives over TLS from the token endpoint, but the code verifies it under `GXP_STRICT` by default and the spec's requirement of an external IdP in production raises the stakes (proxies, gateways, token exchange). The three sources (ADR, code, spec) disagree and operators will not know which is true. Further, an IdP outage means nobody can log in, and group claims are a login-time snapshot.
Example: a corporate TLS-inspecting gateway terminates the token endpoint connection and re-signs; verification is off in non-strict mode and a forged token with admin claims would pass.
Options: (a) always verify against the issuer's keys in production, amend ADR 0001; (b) verify only in strict mode as the code does; (c) leave the ADR as the rule.
Recommendation: (a).
Challenges: ADR 0001; "external IdP required".

## Q19 [Domain] Service principals: non-human actors in a human-accountability model
Service principals are in scope now, so the trail will contain actors that are not people. Every regulation assumes a responsible individual, and a signed merge or approval by a robot is not an e-signature. The spec has no rule for ownership, for what they may sign, for rotation, or for how their activity shows in an audit report.
Example: a pipeline's service principal pushes 5,000 commits a week; an auditor cannot tell which human authorised each, nor whether any of them was an approval.
Options: (a) each service principal has a responsible owner recorded on every event it creates, and may not hold signing capability; (b) allow signing in non-GxP namespaces only; (c) treat them as users.
Recommendation: (a).
Challenges: "service principals in scope now".

## Q20 [Impl] A dedicated search engine as a derived index: authorization and freshness
Metadata search results must respect repository permissions, but a separate index does not know about revocations. Filtering at query time requires the engine to apply the same permission model, or the BFF to post-filter, which breaks pagination and counts. A revoked permission must hide results immediately, while indexing is asynchronous.
Example: Dana loses access to "oncology/trial-7" at 10:00; at 10:02 the index still returns its metadata (patient cohort labels) in search snippets.
Options: (a) the BFF filters every hit through authorization before returning and reports counts only after filtering; (b) index per-namespace permission tags and filter in the engine with a revocation fence; (c) PostgreSQL full text, no new engine.
Recommendation: (a) now; question whether (c) suffices before adding the engine at all.
Challenges: "dedicated search engine (OpenSearch/Meilisearch) as derived index".

## Q21 [Domain] Namespace-scoped metadata schemas from the start, and cross-namespace science
Each namespace owns its metadata schemas. This is clean for authorization but splits shared vocabularies: two teams describing "sample" differently cannot be searched together, and a controlled vocabulary change in one namespace is invisible to another. GxP wants controlled terms and versioned definitions.
Example: Oncology defines `sample.tissue` as a free string and Immunology as an enumerated list, and a cross-namespace search for "liver" returns half the records.
Options: (a) namespace schemas may extend a shared instance-level base schema that carries the controlled core fields; (b) namespace-only, as decided, with import and export tooling; (c) instance-level schemas only.
Recommendation: (a).
Challenges: "namespace-scoped metadata schemas from start".

## Q22 [Domain] Session recording optional even under strict, with clipboard and drive off by default
Desktop Sessions give users a desktop on regulated data. Recording is optional even under `GXP_STRICT`, and clipboard and drive redirection are off by default but can be turned on. Without a recording or a configured exfiltration control, "who did what inside the desktop" is unknowable, and the audit shows only connect and disconnect.
Example: a user in a Desktop Session opens the unblinded file and photographs the screen; the trail shows "connected 14:00-15:10".
Options: (a) recording mandatory in strict mode for Sessions with write access to GxP namespaces; (b) recording optional but the enable-clipboard action requires an audited, reasoned admin decision; (c) as decided.
Recommendation: (b) at minimum, (a) for GxP-flagged namespaces.
Challenges: "session recording optional even under strict"; "clipboard/drive off by default".

## Q23 [Domain] No automatic retries and failed-job outputs retained forever
Jobs do not retry automatically and failed outputs stay in the workspace. This protects reproducibility but a transient infrastructure failure becomes a user task, and failed outputs accumulate with no review. A GxP deviation process needs failures to be distinguishable by cause (infrastructure versus science).
Example: a node drain kills 200 nightly Jobs; each needs a manual rerun, and 200 partial outputs sit beside valid ones with no marker of why they failed.
Options: (a) classify failures (infrastructure versus user code) and allow opt-in retry for infrastructure ones only, with each attempt a separate recorded run; (b) as decided; (c) auto-retry everything.
Recommendation: (a).
Challenges: "no automatic job retries"; "failed-job outputs stay in workspace".

## Q24 [Domain] The review gate is a role, not a review, and the escalation target is unresolved
Merge plus maintain is the review gate, and the reviewer escalation target is explicitly unresolved. A maintain holder can be one person who also authored, who is on leave, or who has left, and nothing escalates. In a regulated process a missing reviewer blocks release, and the workaround is to give more people maintain, which defeats the gate.
Example: the only maintainer is on holiday for two weeks, so the lab lead grants maintain to three more people "temporarily", and it is never revoked.
Options: (a) named reviewer groups with a backup rule and time-limited, audited delegation; (b) escalation to the namespace admin after a deadline; (c) as decided.
Recommendation: (a), and decide the escalation target before specs that depend on it are implemented.
Challenges: "Merge+maintain is the review gate"; unresolved "reviewer escalation target".

## Q25 [Impl] CLI exact-version pin, Node-only, in a rolling-upgrade world
The CLI must be the exact server-pinned version and is Node-only, with binary distribution out of scope. With N instances in a rolling deploy two server versions answer for a while, so which version a CLI is pinned to can be wrong on half the requests. Scientists on laptops, in CI or on air-gapped clusters will be locked out whenever the server upgrades.
Example: the server upgrades at 09:00; 40 scientists get "CLI version mismatch" until they reinstall, and a night Job with the old CLI fails.
Options: (a) a version-compatibility window (n and n-1) with the pin enforced only on breaking contract changes; (b) exact pin as decided with the CLI served from the BFF itself; (c) no pin, contract versioning.
Recommendation: (a).
Challenges: "CLI exact-version pin, Node-only".

## Q26 [Impl] Six stores, no distributed transaction: which one wins per fact?
PostgreSQL, immudb, Novu, oxen, the filesystem and the search index each hold part of the truth, and nothing writes to all of them atomically. After a crash or a partial failure they disagree. The spec's only repair mechanism is the Intent reconciler, and it covers the oxen-and-audit pair only.
Example: a Stage is deleted in PostgreSQL but its tree remains on disk, and the search index still lists its metadata.
Options: (a) a table of every fact, its owning store, the derived copies and the repair job for each; (b) one outbox in PostgreSQL feeding all derived stores; (c) ad-hoc.
Recommendation: (a) and (b) together.
Challenges: Implicit; the spec states persistence per store but no cross-store ownership.

## Q27 [Domain] Validating a platform with an unauthenticated, unpinned third-party core
The system of record is a third-party server with no authentication and a moving image tag, and the platform's integrity claims rest on it. Regulators expect supplier assessment, a defined version and change control. The spec decides on pins, but each oxen release can change API behaviour the reconciler and head capture depend on.
Example: oxen 0.38 changes how it returns the head after a merge; the reconciler infers "not applied" for 200 merges until someone notices.
Options: (a) pin by digest, run a contract test suite against each candidate version, and make the upgrade a controlled change; (b) tag pin, upgrade ad hoc; (c) vendor and fork.
Recommendation: (a).
Challenges: "pinned image tags" without a change-control process; reliance on oxen behaviour for outcome inference.

## Q28 [Impl] Treating the plans as intent only discards verified behaviour with no parity check
The decision is to write specs "as if unbuilt". The code already contains behaviours that plans verified and specs do not mention: directory-sync offboarding, step-up authentication, back-channel logout, service principal suspension. A reimplementation guided by the specs may silently remove them.
Example: the respec for authentication omits step-up; the rebuilt signing flow has no re-authentication and Part 11 11.200 is no longer met.
Options: (a) a parity checklist derived from the code and tests, each item explicitly kept, changed or dropped by the owner; (b) specs only, regressions found by e2e; (c) freeze the code as the spec.
Recommendation: (a), a one-off review of tests as the list of retained behaviour.
Challenges: "plans treated as intent only"; "every JSON store ... in the plans is void".

## Decisions log

| Q | Answer | Date |
|---|--------|------|
| Q1 | Fencing tokens recorded in the tree, checked by every writer; DB is source of truth | 2026-10-25 |
| Q2 | Per-module in-process-state inventory as release gate AND randomized two-instance test on every mutation route | 2026-10-25 |
| Q3 | Absolute fail-closed, risk documented (no protective-action exemption) | 2026-10-25 |
| Q4 | All reads are audited | 2026-10-25 |
| Q5 | Infer Outcome only when verifiable by content digest, else "unknown"; label visible in exports | 2026-10-25 |
| Q6 | Use oxen-returned commit id where available; optimistic base-verify elsewhere; locks only where oxen is not atomic | 2026-10-25 |
| Q7 | Rename with the repository frozen; verify content digest and commit chain before deleting old | 2026-10-25 |
| Q8 | Erasure is impossible in this system; documented as legal-retention stance (note: conflicts with Q8 option analysis; legal sign-off needed) | 2026-10-25 |
| Q9 | Separate "authored by" from "signed by"; no self-signing in GxP namespaces; meaning chosen at signing; step-up at signing | 2026-10-25 |
| Q10 | Revocation lifts "approved" status on dependent Pins, warns downstream lineage, notifies owners | 2026-10-25 |
| Q11 | Keep back-channel logout and directory-based revocation; fix the spec | 2026-10-25 |
| Q12 | Defaults by criticality: action-required on (incl. email), informational in-app only/off | 2026-10-25 |
| Q13 | Test-only fault-injection hooks via the HTTP boundary, crash-point list in spec | 2026-10-25 |
| Q14 | SHA-256 computed in BFF upload stream, stored beside Pin, verified on download/Job input; background verification for other ingress | 2026-10-25 |
| Q15 | Disable URL import until controls (allowlist, redirect re-validation, caps, provenance) exist | 2026-10-25 |
| Q16 | New project: no legacy action names; refactor to `stage` naming directly, no aliases or migration | 2026-10-25 |
| Q17 | Database time orders events; record time and effect time stored separately | 2026-10-25 |
| Q18 | Always verify id_token signature; amend ADR 0001; GXP_STRICT values on by default | 2026-10-25 |
| Q19 | Every event carries a responsible human owner; service principals can never sign | 2026-10-25 |
| Q20 | BFF filters every search hit through authorization; counts after filtering; reconsider Postgres FTS before the engine | 2026-10-25 |
| Q21 | Namespace schemas extend a shared instance-level base schema | 2026-10-25 |
| Q22 | Recording mandatory in strict mode for Sessions touching GxP namespaces | 2026-10-25 |
| Q23 | No automatic retries (as decided) | 2026-10-25 |
| Q24 | Role-only gate (as decided); escalation still unresolved | 2026-10-25 |
| Q25 | Exact pin, CLI served from the BFF itself | 2026-10-25 |
| Q26 | One owner per fact (Postgres=permissions/state, immudb=what happened, oxen=data, FS=files, Postgres projection=messages, search=derived); derived stores rebuilt from Postgres via one outbox; repair job per fact | answered |
| Q27 | Pin oxen by image digest; contract tests per candidate version; controlled upgrade | 2026-10-25 |
| Q28 | One-off parity checklist from code and tests; owner marks keep/change/drop | 2026-10-25 |

---

# Known Issues and Conflicts

## Conflicts with Other Specs (BLOCKERS)

1. **Erasure impossible (Q8)**: Conflicts with option analysis. Legal sign-off needed. **Status blocker.**

2. **Overlay-on-shared-filesystem (Q1)**: 08 Q1 spike UNRESOLVED. Kubernetes is production target (16 Q1) but Jobs unsupported until spike passes (09 Q11). **Status blocker.**

3. **Recording mandate overridden (Q22)**: Global decision and 10 Q4 override Q22 (desktop sessions never recorded); 04 closes it as accepted risk. Compensating controls: one rw session/Workspace + off-box auditd.

4. **Rename superseded (Q7)**: Superseded by 05 Q25 (static physical names, rename only in BFF). 05 Q3-Q6 mostly moot.

## Open Risks and Blockers

5. **Reviewer escalation (Q24)**: CLOSED by 04: `approver` role, one approver suffices, no escalation.

6. **Absolute fail-closed (Q3)**: Holds with no exception. 08 Q18 aggregation dropped (auth round 6 S1). Consequence: immudb outage stops Workspace work at lease expiry. RESOLVED but requires careful lease TTL sizing.

7. **URL import disabled (Q15)**: Entry criteria for re-enabling undefined (06 Q9).

8. **Postgres FTS first (Q20)**: Separate engine needs new ADR (16 Q25).

9. **Backup and restore (16 Q2, 04 Q16)**: Hard start gate. Former deferral void.

10. **Supply chain/SBOM (16 Q21)**: DEFERRED - must close before regulated use.

11. **Maintenance windows only (16 Q27)**: Inferred outcomes remain possible after crash.

12. **Research repository exemption (04 Q10)**: Whether research repos need exemption from always-on strict is open.

## Resolved Conflicts

13. **No automatic retries (Q23)**: 09 Q9 finalize Intent retry and 03 Q21 Outcome retry are bounded internal retries, not mutation retries. Spec must clarify.

14. **Service principals removed (Q19)**: Moot - removed (01 Q12, Q13). Jobs use BFF-internal tokens; automated commits never signed (08 Q7).

15. **Derived store repair (Q26)**: Via Postgres outbox. 04 Q17 verification report-only, never repairs or deletes.

## Update from Authentication Review

16. **GxP beats GDPR (R2, round 5)**: No identity data erasable; no IPs stored. Legal sign-off on no-erasure stance remains open.

17. **Single unchanging IdP**: Iss+sub never reused (auth Q29, S8).

# Impact on Other Specs

## Binds All Module Specs (01-16)

This spec provides decisions that apply to every module. Each module spec inherits these decisions unless explicitly overridden.

## Key Cross-Cutting Decisions

### Persistence (applies to all)
- PostgreSQL relational state, immudb audit, Novu notifications, search engine derived
- Q26: One owner per fact - Postgres=permissions/state, immudb=what happened, oxen=data, FS=files, search=derived

### Multi-Instance (applies to all)
- Q1: Fencing tokens in tree, DB source of truth
- Q2: Per-module in-process-state inventory + randomized two-instance tests

### GxP Strict (applies to all mutations)
- Q3: Absolute fail-closed, no exemptions (RESOLVED)
- Q4: All reads audited
- Q9: Separate authored-by/signed-by; no self-signing in GxP; step-up at signing

### Intent/Outcome (applies to all mutations)
- Q5: Infer only when verifiable by digest, else "unknown"
- Q6: Use oxen commit ID where available; optimistic elsewhere; locks only where needed
- Q17: Database time orders events; record time and effect time separate

### Repository Identity (applies to 02, 05, 11, 12, 13)
- Q7: Static physical names (supersedes copy-based rename)
- Stable repository ID for AuthZ, favorites, metadata, lineage, audit

### Offboarding (applies to 01, 15)
- Q11: Keep back-channel logout and directory-based revocation

### Retention (applies to 03, 06, 11, 12)
- Q8: Erasure impossible; legal sign-off needed (BLOCKER)
- Records kept until deleted, no default expiry

### Notifications (applies to 14)
- Q12: Defaults by criticality (action-required on incl. email, informational in-app/off)

### SSRF and Security (applies to 06)
- Q15: URL import disabled until controls exist
- Fetcher egress-restricted, never in oxen-server

### Integrity Evidence (applies to 06, 11)
- Q14: SHA-256 authoritative; computed in BFF stream, verified on download/Job input

### Identity Provider (applies to 01, 15)
- Q18: Always verify id_token (JWKS, iss, aud, auth_time age); IdP must assert acr/amr/auth_time, startup fails otherwise; ADR 0001 amended (04)
- External IdP required; Keycloak dev-only

### Runners and Jobs (applies to 09, 16)
- Kubernetes production target; Compose dev-only
- Jobs use BFF-internal tokens; service principals removed (Q19)

### Testing (applies to all)
- Q13: Test-only fault-injection hooks at HTTP boundary
- Q28: One-off parity checklist from code/tests

### Authorization (applies to 02, 16)
- Stage naming direct, no aliases or migration (Q16)

### Metadata (applies to 12)
- Q21: Namespace schemas extend instance-level base schema

### Search (applies to 12)
- Q20: BFF filters hits through AuthZ; Postgres FTS reconsidered before engine

### Deployment (applies to 09, 10, 16)
- Q1: Kubernetes production (16 Q1); overlay spike blocks Jobs (BLOCKER)
- Q27: Pin oxen by digest; contract tests; controlled upgrade

## Dependencies and Blocks

### Status Blockers
- Q8: Legal sign-off on no-erasure stance
- Q1: Overlay-on-shared-filesystem spike (08 Q1)

### Open Dependencies
- Q24: closed by 04 (no escalation; approver role)
- Q15: URL import entry criteria undefined (affects 06)
- Q20: Search engine ADR if Postgres FTS insufficient (affects 12)

### Hard Gates
- Backup and restore (16 Q2, 04 Q16)
- Supply chain/SBOM before regulated use (16 Q21)

