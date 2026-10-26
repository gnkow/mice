# 03 — Audit: grilling questions

Status: spec ready-for-agent, but it rests on unproven assumptions: fail-closed on every mutation, an oxen-inferring reconciler, and a head read-plus-lock oxen does not provide. Code today has Intent/Outcome and a self-written immudb transaction verifier (ADR 0005 note), but no reconciler, no locking and no strict mode.
Biggest risks: immudb becomes a single point of failure for the whole platform; "inferred" outcomes are not evidence; tamper evidence has no external anchor; "forever" retention collides with privacy and cost.

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
