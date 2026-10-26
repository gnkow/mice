# 00 — Cross-cutting: grilling questions

Status: the cross-cutting spec is `needs-info` (deployment target, overlay on a shared filesystem, reviewer escalation unresolved) and binds all sixteen module specs.
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
