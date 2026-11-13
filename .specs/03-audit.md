Status: ready-for-agent
Blocked on: nothing from lease renewals (strict, no exemption).

# 03 — Audit (PLAT-AUDIT)

## Problem Statement

Regulated users need proof of who changed what, when, and with what result, that cannot be silently altered, and a mutation must never exist without a record.

## Solution

An Audit module over immudb with append, read range and verify. Every mutation writes an Intent event before it takes effect, then the effect, then an Outcome event (success or failure), linked by `intent_id`. Intent append failure refuses the mutation with 503. Events are appended to immudb directly (no outbox). Outcome append is best-effort after the effect; unpaired Intents remain visible and queryable. An orphan-aging alert notifies operators; no reconciler invents Outcomes.

## User Stories

1. As an auditor, I want to read audit events by time range, actor, action and resource, so that I can investigate.
2. As an auditor, I want to verify the trail with immudb proofs, so that tamper evidence is demonstrable.
3. As a compliance lead, I want every mutation refused when the audit store is down, so that no unrecorded change happens.
4. As an auditor, I want each Intent linked to its Outcome, so that I see whether a mutation completed.
5. As an auditor, I want unpaired Intents to stay visible and alertable, so that crashes leave an honest gap for investigation (not a software-invented Outcome).
6. As an auditor, I want the dataset head before and after each mutation, so that I know which data version was affected.
7. As an auditor, I want reason and change-control id on the event, so that changes are justified.
8. As an auditor, I want to export events in a readable form, so that inspectors can review.
9. As an instance admin, I want audit read access gated by AuthZ, so that sensitive events stay protected.
10. As a security reviewer, I want secrets and tokens never in event detail, so that audit is not a leak.
11. As a developer, I want a documented event schema per action, so that producers are consistent.
12. As an operator, I want `/readyz` to reflect audit health, so that orchestration pulls unhealthy instances.
13. As an auditor, I want reads of audit itself recorded, so that access to the trail is accountable.

## Implementation Decisions

- immudb is the only audit **evidence** store; there is no home-grown hash chain (ADR 0005). A derived Postgres query index may exist for filter performance; it is not evidence.
- Intent failure returns 503 for every mutation (no exceptions, including lease renewals). Reads continue; there is no outbox and no held output ("audit unavailable, nothing was saved"). Failed outcomes are audited when the Outcome append succeeds.
- A health probe and operator alert on audit degradation are required; a single immudb instance is unsupported for production.
- There is no Outcome reconciler and no inferred Outcomes (GxP `#98` wontfix). An Intent without an Outcome is the flag. An orphan-aging alert (default 15 minutes, env-configurable) notifies instance admins; it does not append a ledger flag event or repair the mutation.
- The full e-signature record lives in immudb with `esign.*` events; PostgreSQL holds only an index (04).
- The dataset content digest and oxen commit id are recorded before and after each proxied mutation as `{base, head}`; locks are used only where oxen is not atomic.
- Reason and change-control id are first-class event fields; ownership split with GxP is that this spec stores them and 04 decides when they are required.
- The Audit trail is not entity version history. Successive states of mutable entities (reconstructable prior versions) are owned by those entities' stores and by 04 GxP; this module records who/when/why/result only.
- Events reference repositories by stable id plus the name at event time.
- Every export is audited (filters and row count); browsing reads are recorded as summary events.
- Multi-instance safe: no instance-local queues.
- Chain anchor (no new platform infra): the IQP records the genesis immudb root (and the audit-export **public** key). Verify/export/admin health expose `{txid, root}` for IQ evidence and change-control filings. No WORM bucket or HSM required.
- Export bundle: signed manifest (dedicated export key; pubkey in IQP) + CSV + PDF + verification/proofs.

## Testing Decisions

- HTTP-level tests: perform a mutation, read the Intent and Outcome through the read API, kill the audit store and expect 503.
- Orphan visibility tested by suppressing Outcome append; alert tested when unpaired Intent age exceeds the threshold.
- Prior art: existing audit API tests on the immudb container. Destructive immudb-fault tests run in a serial suite (no parallel CI workers sharing one immudb for those cases).

## Out of Scope

Retention and purge, WORM storage beyond immudb, Outcome reconciler / inferred Outcomes, Postgres outbox / "audit pending" header.

## Further Notes

The extra oxen read adds latency to every mutation; the budget is p95 overhead of 250 ms, tested.

## Alignment with 04 (2026-11-05)

04 is authoritative. Changed here:
- Order is intent, effect, outcome; failed outcomes are audited when recorded.
- Audit outage: all mutations refused, reads continue. No outbox, no "audit pending" header, no held output or finalizing state. Health probe and alert required; single immudb unsupported in production.
- No reconciler invents or flags Outcomes in the ledger; unpaired Intents are the control (alert only).
- Signature records live in immudb (`esign.*`), PostgreSQL index non-authoritative.

Superseded where conflicting: Q1 and Q9 (outbox and relay, compensating Outcome via outbox), Q3/Q4/Q5 (inferred outcomes, "result being confirmed", ledger flag reconciler), Q21 ("audit pending" header, bounded retry then real result), 04-Q12 held output, 09-Q9 finalizing state.

## Deep-api grill lock (2026-11-13)

Authoritative over older "Decisions from grilling" bullets that conflict.

| Topic | Lock |
| --- | --- |
| Write model | No outbox; Intent fail-closed; Outcome best-effort after effect |
| Orphans (US5) | Visible/queryable; `#98` wontfix; 15‑min orphan-aging **alert** (env); no ledger flag event |
| External anchor (Q10) | **(g′)** IQP genesis root + export pubkey; expose root on verify/export/health; no WORM/HSM |
| Export (US8/Q16) | Signed manifest + CSV + **PDF** |
| Query scale (Q14) | Derived Postgres index (not evidence); immudb remains proof store |
| Secrets (Q25) | Allowlist schema per action + secret scanner rejecting token patterns |
| Schema (Q19) | Schema version per event + upcasters; action names never renamed (aliases only) |
| Browse audit (Q15/US13) | Export audited; browsing reads as summary events |
| Holds deepen | Auto-pick `improve-codebase-architecture` Top recommendation, then `tdd` |
| Board scope | Full: gaps + deepen holds + IQP root expose + PG index |
| Process | Clear `#4` needs-info, mint `area:audit` sub-issues, one commit per ticket |

## Decisions from grilling (historical — superseded where conflicting)

The following bullets are retained for archaeology. Where they conflict with **Alignment with 04** or **Deep-api grill lock**, the lock wins.

Write path and reconciliation — **SUPERSEDED** (outbox, audit-pending, ledger reconciler): see grill lock.
- ~~Postgres outbox + batching~~ → direct immudb append.
- ~~Compensating Outcome via outbox~~ → none.
- ~~Reconciler completes Outcome / ledger flag~~ → `#98` wontfix; alert only.
- Event ids deterministic/client-supplied where used; conflict means already stored (Q22) — still valid if implemented.
- Inherited: absolute fail-closed on Intent (Q2), oxen commit id / observed base-head (Q6), database time ordering (Q18), no service principals (Q24).

Evidence and integrity
- Dataset content digest plus oxen commit id before/after (Q7) — still in scope.
- External root: **grill lock (g′)** replaces "publish to external sink" (Q10).
- immudb pinned; CI cross-check; official auditor in production (Q11).
- Scheduled verify + alert + integrity-incident; GXP_STRICT read-only option (Q12) — residual interaction with no break-glass remains a RISK.
- Derived Postgres query index + verification (Q14) — **in scope** per grill lock.
- immudb follower replication + snapshots (Q17); p95 ≤250 ms (Q8).

Schema, export and access
- Schema version + upcasters; aliases not renames (Q19) — in scope.
- Allowlist + secret scanner (Q25) — in scope.
- Export audited; browse summaries (Q15) — in scope.
- Export: signed manifest + CSV + PDF (Q16) — in scope per grill lock.
- Auditor role / SoD (Q23); legal retention inherited (Q13); serial destructive CI (Q26) — CONFIRM interpreted as serial suite.

## Conflicts and open risks

- Lease renewals: audited per renewal (08 Q18 revised); RESOLVED. Event volume must be capacity-planned.
- Q26: serial destructive suite interpretation — accepted for this board; revisit if CI topology changes.
- Q17 vs former backup deferral: OVERRODE; backup/restore remain a start gate (04/16).
- Q15 vs 02 Q9: summary granularity for routine vs sensitive reads — implement page/session summaries; refine per endpoint if AuthZ disagrees.
- Q12 read-only flip vs no break-glass (15 Q7): incident-response RISK unchanged.
- Q23 and 04 Q8: signature records in immudb; Postgres index non-authoritative.
- Outcome after successful mutation can still be missing under immudb fault: accepted under GxP (honest orphan + alert), not an outbox redesign.

---

# Open Questions

Status: grill-locked 2026-11-13 (see **Deep-api grill lock**). Historical Q1–Q26 below; answers that conflict with the lock are superseded (notably outbox Q1/Q9/Q21, inferred/reconciler Q3–Q5, external WORM sink Q10 → IQP (g′)).
Biggest residual risks: immudb is still a write SPOF for mutations; forever retention vs privacy; Q12 integrity→read-only with no break-glass.

## Q1 [Impl] immudb is a single writer, yet N BFF instances and fail-closed-on-everything depend on it
Every mutation on every BFF instance needs a synchronous immudb append before it proceeds, and the cross-cutting decision removes all exemptions. immudb replicates read-only; there is one write node. A node restart, disk-full or upgrade therefore stops all writes platform-wide, including favorites, notification read-marks and lineage. Having N instances buys no write availability at all.
Example: Tuesday 02:10 immudb is restarted for a patch and takes 4 minutes to reload a 300 GB database. For 4 minutes 6 BFF instances answer 503 to 40 scientists, and a Job commit mid-flight fails.
Options: (a) accept and publish an availability SLO for the audit store (simple, but is the platform really that tolerant?); (b) a durable local outbox per instance with later flush (breaks "no mutation without a record" and is explicitly forbidden); (c) tier mutations so only regulated classes are fail-closed (needs a classification the owner has refused).
Recommendation: (a) plus a defined maintenance window procedure, and revisit (c) for non-GxP-record mutations (see Q2).
Challenges: "Intent failure returns 503 for every mutation (no exceptions)" and "N BFF instances required".

## Q2 [Domain] Is a favorite or a notification mark really a "GxP record" that must be fail-closed?
Part 11 and Annex 11 require audit trails for records that are GxP-relevant, not for UI preferences. Treating a pin of a favorite as equal to a merge floods the trail with noise and turns an audit outage into a total outage. Auditors also have to wade through the noise, and every event is retained forever.
Example: A scientist stars 30 repositories during onboarding and marks 200 notifications read; that is 460 Intent/Outcome events, against 3 events for the merge the inspector cares about.
Options: (a) keep one rule for everything (uniform, loud); (b) two classes, "regulated record" (fail-closed, Intent/Outcome) and "preference" (best-effort single event); (c) preferences not audited at all.
Recommendation: (b), with the class list reviewed by QA and listed in validation documents.
Challenges: "No class is exempt" and "lineage writes also fail-closed".

## Q3 [Impl] The reconciler "infers" an outcome by re-querying oxen. What does that prove?
An orphaned Intent could mean the request never reached oxen, reached it and succeeded, or partly succeeded. Re-reading oxen gives current state, not what happened. Many mutations are not observable after the fact (a delete followed by a re-create, a branch repointed twice, a no-op write).
Example: Intent "update branch main to commit C7" is orphaned. By reconciliation time main points to C9 because someone else pushed. The reconciler cannot tell whether our update was applied and then superseded, or never applied.
Options: (a) append Outcome "unknown/indeterminate" with the observed state and flag for human resolution (honest); (b) infer and record as definitive (looks tidy, risks false statements in a regulated record); (c) make mutations idempotent via a request id passed to oxen where possible and check that.
Recommendation: (a) as the default, (c) where oxen allows; never write a definitive Outcome that was inferred without marking it as such.
Challenges: "reconciler re-queries oxen to infer the result"; user story "never see a mutation of unknown result".

## Q4 [Impl] Who runs the reconciler, and what stops two instances appending two Outcomes?
N BFF instances all see the same orphaned Intent after a crash. The plan says "no instance-local queues" but names no coordination. Audit is append-only, so a duplicate or conflicting Outcome can never be corrected.
Example: instance A crashes mid-merge; instances B and C both wake their reconciler at the 5-minute mark. B reads head=H2 and writes "success"; C, 200 ms later after another push, reads H3 and writes "failed".
Options: (a) a database lease/advisory lock elected leader (simple, a single point of progress); (b) per-Intent claim row in PostgreSQL with unique constraint on the intent id (parallel, safe); (c) first Outcome wins and later ones are rejected by a read-before-append (racy in immudb).
Recommendation: (b), and define in the schema that exactly one terminal Outcome per Intent is valid.
Challenges: "Multi-instance safe: no instance-local queues" (stated, not designed).

## Q5 [Impl] How long may an Intent be orphaned before it is "orphaned", and what is the user told meanwhile?
A slow large upload or rename may legitimately take an hour. A reconciler with a short threshold marks live operations as crashed; one with a long threshold leaves the auditor with unresolved Intents for hours. There is also no heartbeat concept.
Example: A 900 GB repository rename runs for 70 minutes. With a 15-minute threshold the reconciler appends an Outcome "failed" while the copy is still running.
Options: (a) per-action-class timeouts (accurate, config surface); (b) the running operation renews a lease heartbeat, reconciler acts only on expired leases (robust, more state); (c) one global threshold (simple, wrong).
Recommendation: (b).
Challenges: New gap.

## Q6 [Impl] A "lock" around the dataset head read: oxen has none, so what is being locked?
The spec says the BFF reads the head, proxies, reads the head again "with a lock". oxen-server gives no repository lock to the BFF; an in-process mutex does not span N instances, and a PostgreSQL advisory lock only protects against other BFF traffic, not CLI pushes that also go through BFF but run concurrently on other instances for other branches. A coarse per-repo lock serialises every write to a repository.
Example: Two scientists push to different branches of one 50-person repository. A per-repo advisory lock makes the second wait for the first push of a 3 GB upload, which takes 9 minutes, so a 10-second branch create queues behind it.
Options: (a) per-repo lock for the whole mutation (correct, throttles); (b) no lock, record "observed base/head" and mark as best-effort evidence (honest, weaker claim); (c) lock only around the short head reads, not the mutation (cheap, does not prove causality).
Recommendation: (b) or (c), and word the audit field as "observed", not "affected".
Challenges: "Before/after dataset head is read, with a lock, around every proxied mutation".

## Q7 [Domain] Does `{base, head}` actually tell an auditor which data version a mutation affected?
Under concurrency, a head read after the mutation may include other people's commits. Many mutation classes (branch delete, role change, favorite) have no dataset head at all, or a head per branch. The default-branch head is not what a file write on a feature branch changed.
Example: Ana writes to branch "assay-7"; Bo merges to main between Ana's two reads. Ana's event records main's head moving from H1 to H2, attributing Bo's change to Ana.
Options: (a) record the target ref plus the commit created by the mutation, taken from oxen's response (precise where available); (b) record repo head for all (simple, misleading); (c) record head only for dataset-changing classes.
Recommendation: (a) with (c) as fallback; define per action class which refs are captured.
Challenges: "for every mutation class the BFF reads the dataset head before and after".

## Q8 [Impl] The extra reads add latency and load to every mutation. What is the budget?
Each mutation now costs two immudb appends, two oxen head reads and possibly a lock wait. The spec says "measure it" but sets no ceiling and no kill-switch. Bulk operations (file uploads of 10,000 small files via CLI) multiply it.
Example: A CLI push of 10,000 files, if audited per file, makes 20,000 immudb writes plus 40,000 oxen reads before the first byte is committed.
Options: (a) audit at the logical operation (push/commit) granularity, not per file chunk (small trail, clear); (b) per-file (maximal detail, load); (c) logical event with a file manifest digest attached.
Recommendation: (c); set a p95 added-latency budget (for example 150 ms) as an acceptance test.
Challenges: "The extra oxen read adds latency to every mutation; measure it" (no target).

## Q9 [Impl] What guarantees atomicity between a PostgreSQL change and its immudb Intent/Outcome?
Many mutations (role grants, memberships, signatures, rename id mapping) change PostgreSQL, and the audit lives in immudb. They cannot share a transaction. A crash between a committed PostgreSQL change and the Outcome append leaves a state change with only an Intent, and the reconciler cannot "re-query oxen" because oxen was never involved.
Example: Admin grants "view_audit" to Carol; the row commits; the instance dies before the Outcome. The reconciler checks oxen and finds nothing relevant.
Options: (a) the reconciler reads PostgreSQL for non-oxen classes (needs a per-class resolver); (b) write the Outcome in the same PostgreSQL transaction as an outbox row and ship to immudb (breaks the "record before effect" guarantee only for Outcome, which is acceptable); (c) idempotent re-run of the change.
Recommendation: (b) for Outcomes, keep Intent synchronous.
Challenges: Reconciler "re-queries oxen" only; ignores Postgres-only mutations.

## Q10 [Domain] Tamper evidence has no external anchor. Is that acceptable to an inspector?
After ADR 0005 the signed checkpoints were deleted. immudb's proofs verify consistency relative to a state the client holds. If the BFF holds no previously verified state outside the database, an operator with database access can rebuild the whole ledger and every verification passes. Auditors normally want evidence not controlled by the party being audited.
Example: A DBA with root on the immudb host replaces the database on Friday night, rewriting a 4 May deletion event. The Monday verify succeeds because the root is recomputed.
Options: (a) periodically publish the latest root to an external write-once sink (object lock, email to QA, a separate signing service); (b) QA holds verified state offline; (c) accept as is and document the risk.
Recommendation: (a) with a weekly QA-owned signed root; revive the checkpoint idea in the new form.
Challenges: ADR 0005 "tamper evidence depends entirely on immudb's proofs".

## Q11 [Impl] Our own transaction-chain verifier replaces the broken client library. Who validates it?
The note in ADR 0005 states the official Node client fails its own proof verification, so the platform implements the checks itself. In a validated system this verifier is the control the auditor is told to trust, and it is custom code against one immudb version (1.9.5). An immudb upgrade may change the format silently.
Example: immudb moves to 1.10; the verifier still returns "ok" because a changed hash input is skipped on an unknown field.
Options: (a) pin immudb version, add cross-checking against the immudb CLI/auditor tool in CI (cheap, tested); (b) contribute fix upstream and drop custom code (slow); (c) run the official immudb auditor as a separate component.
Recommendation: (a) now, (c) for production.
Challenges: ADR 0005 implementation note (accepted as a footnote).

## Q12 [Domain] When and by whom is `verify` run, and what happens on failure?
The spec says auditors can verify, but no cadence, owner or failure response exists. A failed verification at 3 am with fail-closed semantics might mean the platform should stop accepting mutations, or it might be a false alarm.
Example: Nightly verify reports a mismatch in transaction 41,200,018. Do mutations continue? Who is paged? Is the instance deemed "not validated" until QA investigates?
Options: (a) scheduled verify plus alert, mutations continue (availability); (b) a failed verify flips the platform to read-only (integrity-first, risky); (c) manual on demand only.
Recommendation: (a), with a runbook and a distinct "integrity incident" audit event; make (b) a strict-mode option.
Challenges: New gap.

## Q13 [Domain] "Retain forever" meets personal data in immutable events
Events carry actor name, email and often free-text reasons. The owner chose infinite retention and no purge API, and immudb cannot delete. GDPR erasure and works-council rules for employee data conflict with this, and cost grows without bound.
Example: A contractor leaves in 2027 and files an erasure request. Their name and email appear in 18,000 immutable events.
Options: (a) store a pseudonymous Principal reference in events and the name in a separately deletable table (resolves, costs a join in every view); (b) keep as is and document the legal basis (Part 11 over GDPR, needs counsel); (c) encrypt per-person fields with a deletable key (crypto-shredding).
Recommendation: (a).
Challenges: "Retention forever"; "Events keep personal data inline, never erased".

## Q14 [Impl] How big does the trail get, and how fast can you query it?
Read range by actor, action and resource is required, but immudb is a key-value ledger; arbitrary filters need secondary indexes or a scan. With every mutation producing two events and no expiry, size and scan times grow without limit, and the verifier walks the whole chain.
Example: 400 users produce 150,000 events a day; after three years there are 160 million events. A filter "actor = ana, action = merge, 2026" must not scan them all, and a full verify takes hours.
Options: (a) a derived PostgreSQL index for query, immudb for proof (fast, second copy that can drift); (b) immudb SQL/secondary indexes (single system, constrained); (c) partition by month with per-partition verification.
Recommendation: (a) plus (c), and state that the derived index is not evidence.
Challenges: Spec assumes the read API is simple.

## Q15 [Impl] Reading the audit trail is audited (story 13) but export is not. Why?
User story 13 requires access to the trail to be accountable. The decisions say export reads are not separately audited. An export is the most complete and portable form of access, and exactly what a leaking insider would use.
Example: A namespace owner exports a year of events including colleagues' reasons and change-control ids to a USB stick; there is no record that this happened.
Options: (a) audit all reads including export with filters used and row counts (complete, increases volume); (b) audit only export; (c) keep as decided.
Recommendation: (b) at minimum, with the filter and count in the event.
Challenges: "Export reads are not separately audited" vs user story 13.

## Q16 [Domain] What does an inspector actually receive in an export, and can they trust it?
The export bundle is unsigned and verification is a separate live operation. An inspector handed a file cannot independently verify it was not edited between export and handover. Part 11 §11.10(b) requires accurate and complete copies in human-readable and electronic form.
Example: QA exports 12,000 events for a supplier audit, an auditor asks "how do I know this file is the same as what is in the system?"
Options: (a) the bundle includes immudb proofs and a signed manifest digest (verifiable offline); (b) PDF/CSV reports for people plus a machine bundle; (c) live read-only auditor account.
Recommendation: (a) and (b).
Challenges: "unsigned" export bundle (ADR 0005 consequence).

## Q17 [Impl] Backup of immudb is out of scope, but retention is forever
The audit store is the one component that cannot be rebuilt from another. The cross-cutting decision defers backup. A volume loss or corruption destroys the regulatory record, and a restore would produce a database whose proofs no longer match anything an auditor holds.
Example: The immudb volume corrupts on an RWX storage failure; the last copy is a 4-week-old snapshot; 4 weeks of mutations exist in oxen with no audit.
Options: (a) immudb replication to a follower in another zone, plus snapshot (cheap to start); (b) defer, accept risk and document as a validated limitation; (c) dual-write to a second immudb.
Recommendation: (a), because "deferred" should not apply to the only non-reconstructable store.
Challenges: "backup/restore deferred"; "Out of scope: backup of immudb".

## Q18 [Impl] Whose clock stamps events, and how are events ordered across instances?
Timestamps come from whichever BFF instance handled the request. Skew of seconds between hosts can order an Outcome before its Intent or two related events backwards. ALCOA "contemporaneous" is claimed on this timestamp.
Example: Instance A (clock +4 s) writes Intent at 10:00:04; instance B reconciler writes the Outcome at 10:00:02 by its clock.
Options: (a) immudb transaction time as the authoritative time (server-assigned, single clock) with the BFF time as an extra field; (b) NTP requirement only; (c) a hybrid logical clock.
Recommendation: (a), plus NTP monitoring.
Challenges: "Contemporaneous timestamps ... NTP assumed in deploy".

## Q19 [Impl] What is the event schema versioning story when events are immutable for decades?
Eleven user stories ask for a documented schema per action. Old events can never be migrated. Readers, export and the derived index must understand every historic shape, including the pre-immudb ones and renamed actions (the Stage rename is already planned).
Example: In 2028 the action "workspace.commit" is renamed to "stage.commit"; a query for "all commits in 2027 and 2029" must find both.
Options: (a) an explicit schema version on each event and read-time upcasters (robust); (b) never rename, add aliases (simple, messy vocabulary); (c) rewrite-in-place, which is forbidden.
Recommendation: (a) with (b) as a policy for action names.
Challenges: Stage naming migration; "documented event schema per action".

## Q20 [Impl] What about denied, failed-auth and read-sensitive actions?
The Intent/Outcome rule is for mutations. Part 11 and Annex 11 inspectors also ask about unauthorised access attempts and about who downloaded regulated data. Today a denied write produces 403 and, possibly, nothing in the trail. Large exports of data are reads.
Example: A departed employee's PAT is used 300 times from a new address to download a repository; each call is a GET and nothing is audited.
Options: (a) audit denials and security events (login failures, revoked PAT use) always; (b) also audit bulk-data reads above a size threshold; (c) only mutations as now.
Recommendation: (a) and (b) with sampling/aggregation to control volume.
Challenges: Mutation-only scope.

## Q21 [Impl] If the Outcome append fails after the mutation succeeded, what does the client see?
The mutation is already applied in oxen; returning 503 tells a scientist it failed when it did not, and a retry may double-apply. Returning 200 without an Outcome relies on the reconciler. The spec only defines the Intent-failure branch.
Example: A merge succeeds in oxen; immudb times out on the Outcome; the user sees 503 and presses merge again, producing a second merge commit.
Options: (a) return the real result plus a header "audit pending", the reconciler completes it (truthful); (b) return 503 (consistent, misleading); (c) retry the Outcome append inline with a bounded budget, then (a).
Recommendation: (c).
Challenges: New gap.

## Q22 [Impl] Appending is not idempotent. How are duplicates prevented on timeout retries?
A network timeout on an immudb write leaves the caller not knowing whether the event was stored. A blind retry creates duplicate Intent events, and the immutable trail cannot be cleaned. Auditors will read two Intents for one action.
Example: An Intent append times out after 5 s; the BFF retries; immudb had committed the first. The trail shows two Intents for one merge and one Outcome.
Options: (a) client-supplied deterministic event id as the key, with a conflict meaning "already stored" (clean); (b) accept duplicates and de-duplicate on read; (c) never retry, fail the request.
Recommendation: (a).
Challenges: New gap.

## Q23 [Domain] Who may read the audit trail, and who watches the watchers?
Instance admins, `view_audit` holders and namespace owners can read events. The same instance admins can revoke identities, run the admin console, and via the bootstrap path grant themselves roles. There is no separation of duties between those who administer and those who review administration.
Example: A bootstrap admin grants themselves a role at 14:00, uses it, and revokes it at 14:20; reading the trail, they can also view who looked at their events (the read of the audit is audited, but they hold the read right).
Options: (a) a distinct auditor role that admins cannot self-assign without a second admin and an alert to QA (separation of duties); (b) as is; (c) read-only external auditor account issued by QA.
Recommendation: (a).
Challenges: "audit read access gated by AuthZ" with admin as a superset.

## Q24 [Domain] Actors that are not people: reconciler, runners, workers, service principals
Service principals are now in scope, along with runners and the notification worker that projects audit. Events attributed to "system" are exactly what an inspector challenges. Reason fields and signatures apply to humans.
Example: A Job's service principal commits a result to a regulated repository; who is accountable, the launcher, the owner of the Job definition or the service principal?
Options: (a) every non-human actor event carries the initiating human Principal plus the service principal; (b) service principal only; (c) forbid unattended mutations in strict mode.
Recommendation: (a).
Challenges: New gap for service principals in scope.

## Q25 [Impl] What exactly may go into `detail`, and who enforces it?
Story 10 forbids secrets, and the reason field is free text that scientists will use to paste error messages, sample ids or a token. Events are immutable, so one leak is forever. Proxied bodies may contain tokens or PHI.
Example: A scientist writes the reason "pasted oxen config with token mice_pat_AB12..." in a merge dialog; it lands in an immutable event.
Options: (a) allowlist schema per action plus a secret scanner on free text that rejects the mutation (strong, friction); (b) denylist redaction (leaky); (c) length limits and warnings only.
Recommendation: (a) for structured fields; scanner with reject for obvious token patterns.
Challenges: "secrets and tokens never in event detail" (no mechanism).

## Q26 [Impl] How does the test strategy survive an append-only store that tests cannot clean?
Tests run in parallel against real immudb, cannot delete events, and one required test kills the audit store to expect 503. Killing the shared container breaks every other parallel test and developer. The black-box rule also makes crash-in-the-middle reconciliation tests hard.
Example: CI worker 1 stops immudb to test the 503; workers 2-7 fail 90 tests.
Options: (a) a dedicated fault-injection instance of immudb or a proxy that blocks the port per test (isolated); (b) a test-only switch in the BFF (violates black-box); (c) run destructive tests in a serial suite.
Recommendation: (a) with a fault-injecting TCP proxy in front of immudb, and (c) for crash tests.
Challenges: "Testing seam: BFF HTTP boundary, black-box, real containers".

## Decisions log
| Q | Answer | Date |
| --- | --- | --- |
| Q1 | Central audit-writer path via Postgres outbox + batching; single-writer contention spiked with latency SLO | answered |
| Q2 | Inherited: absolute fail-closed (00 Q3) | answered |
| Q3 | Inherited: infer only when verifiable by digest else unknown (00 Q5) | answered |
| Q4 | One reconciler leader via PG advisory lock; Outcome idempotent by intent id | answered |
| Q5 | Orphaned after 2 min (configurable); UI 'result being confirmed'; QA alert >15 min | answered |
| Q6 | Inherited: oxen commit id / optimistic base-verify (00 Q6) | answered |
| Q7 | Record dataset content digest before/after + oxen commit id | answered |
| Q8 | p95 mutation overhead ≤250 ms budget, tested; uploads check at start/publish | answered |
| Q9 | PG outbox in same txn; relay to immudb; Intent precedes mutation; compensating Outcome if DB commit fails | answered |
| Q10 | Periodic external publication of immudb root hash, verified on schedule | answered |
| Q11 | Pin immudb; CI cross-check vs immudb tooling; official auditor in production | answered |
| Q12 | Scheduled verify + alert + integrity-incident event; read-only flip in GXP_STRICT | answered |
| Q13 | Inherited: legal-retention stance (00 Q8) | answered |
| Q14 | Derived Postgres query index (not evidence) + monthly partitioned verification | answered |
| Q15 | Audit every export (filters + row count); browsing reads as summary events | answered |
| Q16 | Export bundle with proofs + signed manifest + human-readable CSV/PDF | answered |
| Q17 | immudb follower replication + scheduled snapshot now (exempt from 'backup deferred') | answered |
| Q18 | Inherited: DB time orders events (00 Q17) | answered |
| Q19 | Schema version per event + upcasters; action names never renamed, aliases only | answered |
| Q20 | Inherited: successes to immudb, failures to ops log (01 Q23) | answered |
| Q21 | Bounded inline Outcome retry, then real result + 'audit pending' header; reconciler completes | answered |
| Q22 | Deterministic client-supplied event id; conflict = already stored | answered |
| Q23 | Distinct Auditor role; no self-assign without second admin; QA alert; audit-of-audit by others | answered |
| Q24 | Inherited: service principals removed | answered |
| Q25 | Allowlist schema per action + secret scanner rejecting token patterns | answered |
| Q26 | Answer truncated ('No ci worker'): interpreted as no parallel CI workers sharing immudb, i.e. serial destructive suite — CONFIRM | answered |

---

# Known Issues and Conflicts

## Lease renewal audit reconciliation
- **Lease renewals audited per renewal (08 Q18 revised)**: RESOLVED. No aggregation, no exemption. Every renewal has Intent/Outcome. CONSEQUENCE: high event volume – must capacity-plan immudb for lease renewal load (every few seconds per active Workspace or Job). Relates to authentication round 6 S1 (strict, no exemption).

## Backup and replication conflicts
- **Q17 (immudb follower replication + scheduled snapshot now) contradicts former "backup of immudb out of scope"**: OVERRODE the deferral. Spec is corrected; 04 Q16 and 16 Q2 make backup and restore a hard start gate before regulated use. Audit is the only non-reconstructable store.

## Browsing read summarization alignment
- **Q15 (browsing reads summarized per page or session) versus 02 Q9**: Alignment needed on summary granularity. Sensitive reads and bypass mutations are individual events; routine listing reads become summary events. Must define what "routine" and "sensitive" mean for each list endpoint.
- **Q15 contradicts earlier "export reads are not audited" line**: CORRECTED. Every export is audited (filters + row count); browsing reads as summary events.

## Integrity failure response
- **Q12 (read-only flip on integrity failure)**: The read-only flip is itself a mutation freeze. Interacts with 15 Q7 (break-glass declined), creating an incident-response RISK. If immudb integrity fails and GXP_STRICT flips to read-only, no mutations can occur until manual intervention. No break-glass path exists.

## Audit pending header and reconciler guarantee
- **Q21 (audit pending header lets user see result before Outcome stored)**: The user receives the mutation result with "audit pending" header before the Outcome is persisted. The reconciler MUST guarantee eventual completion. If the reconciler fails, the mutation succeeded but has no Outcome, violating Intent/Outcome pairing.

## Open questions and unconfirmed details
- **Q26 (answer truncated, "No ci worker" interpretation)**: Interpreted as: no parallel CI workers sharing immudb; destructive suite runs serially. NEEDS CONFIRM from owner. If parallel workers must share immudb, fault-injection strategy changes.
- **Q5 (QA alert after 15 minutes)**: Depends on 16 Q4/Q5 availability targets (not yet set). Alert threshold for orphaned Intents cannot be calibrated until availability targets are defined.
- **Q10 (external publication of root hash)**: Destination for periodic root hash publication not chosen by owner. Options include QA-owned signed root, object-locked storage, or external signing service. PENDING.

## Exception documentation and ADR needs
- **Q9 (compensating Outcome after failed database commit)**: Exception to "Outcome follows mutation". Must be documented in event schema. The Outcome is appended even though the domain transaction rolled back, marking it as "failed" or "rolled back".

## Single-writer contention spike
- **Q1 (single-writer contention only spiked)**: A failed spike would force a redesign of the outbox and relay architecture. Central audit-writer path with Postgres outbox is unproven at load. Latency SLO must be met.

## Signature record size and storage
- **Q23 and 04 Q8 (signature records in immudb with Postgres index only)**: Signature manifestation is large (name, iss, sub, time, meaning, record hash, MFA evidence). Immudb handles it, but index must stay non-authoritative. Queries use Postgres; verification and legal evidence use immudb.

# Impact on Other Specs

## Blocks or dependencies
- **Blocks all mutation specs**: Fail-closed Intent/Outcome (Q2, inherited 00 Q3) means every mutation in every module depends on audit append succeeding. Any module with mutations (01, 02, 03, 04, 05, 08, 09, 11, 12, 13, 14, 15, 16) must handle 503 on audit outage.
- **Blocks 04 (GxP Compliance)**: Signature records (Q8, 04 Q8) live in immudb; must handle record size and proofs. Integrity verification (Q12) can flip GxP_STRICT to read-only.
- **Blocks 08 (Workspaces)**: Lease renewal audit (Q18) adds high event volume. Compensating Outcome on failure (Q9) applies to Workspace commit operations.
- **Blocks 09 (Jobs)**: Finalizing state (Q21, 09 Q9) and audit-pending header allow result visibility before Outcome persists. Reconciler must complete orphaned Job Intents.

## Depends on
- **Depends on 00 (Cross-cutting)**: Absolute fail-closed (Q2/00 Q3) with no exemptions. Inferred outcomes (Q3/00 Q5) only when digest-verifiable. Database time ordering (Q18/00 Q17).
- **Depends on 01 (Authentication)**: Successes to immudb, failures to ops log (Q20/01 Q23). Redaction rules (Q25) must align with authentication's secret handling.
- **Depends on 04 (GxP Compliance)**: Legal-retention stance (Q13/00 Q8). Signature record format and size (04 Q8).
- **Depends on 16 (Operations)**: Availability targets (Q5 alert threshold). Backup and restore as start gate (Q17/04 Q16/16 Q2). immudb pinning and auditor tool (Q11).

## Cross-cutting impacts
- **01 (Authentication)**: Audit of authentication events (login, logout, refresh, step-up, failure, revocation) with request id and Principal (authentication T7). No tokens/cookies logged; redaction tested (Q25).
- **02 (Authorization)**: Summarization strategy for routine reads (Q15/02 Q9). Bypass mutations audited individually; listing reads summarized.
- **04 (GxP Compliance)**: Signature storage (Q8), integrity verification (Q12), no held output (04 Q12 superseded: mutations are refused during an audit outage), traceability matrix (Q26/04 Q26).
- **05 (Repositories)**: Rename and transfer audited as dedicated actions (Q7, inherited 00 Q6). Observed base/head plus oxen commit id (Q7).
- **08 (Workspaces)**: Conflict detail in Postgres with digest in audit event (Q16/08 Q16). Lease renewals per renewal (Q18/08 Q18).
- **09 (Jobs)**: Finalizing state with audit-pending header (Q21/09 Q9). Job I/O normalized table (Q24/09 Q24); lineage is single edge store.
- **11 (Lineage)**: Lineage writes fail-closed (inherited). Operation hash in immudb (Q12/11 Q12) adds write per lineage op; covered by latency budget.
- **12 (Metadata/Search)**: Export audited with filters and row count (Q15). Sparse file capture (Q10/12 Q10) with head-capture exception needs ADR sign-off.
- **13 (Favorites)**: Favorites audit exemption (Q1/13 Q1) conflicts with absolute fail-closed; must be reconciled in 00/03.
- **14 (Notifications)**: Notification delivery audited; Postgres projection is authoritative (Q8/14 Q8).
- **15 (Administration)**: Security events (suspend, revoke) audited with no deferred append (authentication R8). Auditor role (Q23) with separation of duties.

