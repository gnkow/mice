Status: ready-for-agent

# 16 — Deployment, state and operations (PLAT-OPS)

## Problem Statement

Operators need a production deployment that is safe by default, runs several BFF instances, and does not depend on dev conveniences. The production target is Kubernetes.

## Solution

Containerised production stack on Kubernetes (PostgreSQL, immudb, Novu with MongoDB and Redis, BFF, web; a search engine only if Postgres full-text fails measurement) with pinned image digests, a production start gate, split liveness/readiness/degraded health endpoints and an external IdP.

## User Stories

1. As an operator, I want the BFF to refuse to start with dev defaults, so that insecure configs never ship.
2. As an operator, I want pinned image tags, so that oxen-server API changes are deliberate.
3. As an operator, I want `/readyz` to go red on any dependency outage, so that traffic stops.
4. As an operator, I want to run N BFF instances behind a load balancer on shared storage.
5. As an operator, I want an external IdP, with Keycloak only for dev.
6. As an operator, I want production images that do not install packages at start.
7. As a security reviewer, I want the Docker socket dev-only; production uses a separate runner service behind a restricted proxy.
8. As an operator, I want secrets supplied by a secret manager.
9. As an operator, I want logs and metrics suitable for monitoring.
10. As a compliance lead, I want a documented NTP requirement, so that timestamps are contemporaneous.

## Implementation Decisions

- Target is Kubernetes for the first regulated release; Compose is dev-only; other targets are unsupported.
- Multi-instance replaces every single-process guard with Postgres leases and fencing after an inventory; auth state moves to Postgres with stateless cookies and no sticky routing.
- Shared RWX storage for bulk trees is subject to a time-boxed spike with pass criteria; fallback is copy or node-local scratch.
- The backup contract is a hard start gate (04): ordered quiesced snapshot plus manifest, post-restore reconciler, rehearsed restores. An availability target is set first.
- Database migrations run pre-deploy under an advisory lock with expand-contract (ADR); database operations remain the database containers' own.
- Non-atomic disk writes for jobs and aliases move into PostgreSQL; queues use SKIP LOCKED with lease and fencing.
- Deploys happen in maintenance windows only.

## Testing Decisions

- Start-gate tests for dev-default rejection; two-instance e2e; outage tests for readiness.
- Prior art: existing readiness tests.

## Out of Scope

HA of databases and retention policy beyond the backup start gate (backup/restore itself is now in scope, Q2/Q3).

## Further Notes

Target decided: Kubernetes (Q1).

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Target and topology
- Kubernetes for the first regulated release; Compose dev-only; others unsupported (Q1).
- Inventory single-process guards; Postgres leases with fencing (Q6).
- Auth state in Postgres; stateless cookies; no sticky routing (Q16).
- SKIP LOCKED queues; lease plus fencing for verifier and reconciler (Q15).
- Shared storage spike with pass criteria; fallback copy or node-local scratch (Q7).
- Dev-only Docker socket; production runner behind a restricted proxy (Q8).

Backup, restore, availability
- Backup contract is a hard start gate, inherited from 04 (Q2).
- Ordered quiesced snapshot plus manifest; post-restore reconciler; rehearsed (Q3).
- State availability target set first, e.g. 99.5% and 4h RTO (Q4).
- Quotas, usage and 80% alert; manual deletion (Q23).

Start gate, security, time
- Invert default; dev flag; rejection list; per-rule start-gate tests (Q10).
- Operator and app database roles; periodic comparison; external DB audit logging (Q11).
- Authoritative database time plus skew checks (Q12).
- Key ring with owner and schedule (Q13).
- NetworkPolicy, pinned digest, supplier assessment, mTLS sidecar for immudb/Novu paths (Q14).
- Source IPs are NOT stored anywhere (auth round 5); Q19 address recording dropped; trusted-proxy config gate retained only for scheme/host handling.

Operations and delivery
- Split liveness, readiness, degraded (Q5); cached dependency health, details to operators (Q26).
- Pre-deploy migration under advisory lock; expand-contract; ADR (Q9).
- Streaming with timeouts, limits, load test criterion (Q17); fixed performance targets, p95 overhead at most 250ms (Q18).
- Full tracing now with request id into Intent events, redaction, retention (Q20).
- Tiered pipelines; full suite as release gate (Q22).
- Fault-injection harness at the boundary (Q28).
- Wipe pilot: no migration, stable ids from day one (Q24).
- Postgres full-text first, inherited (Q25).
- Maintenance windows only for deploys (Q27).

## Conflicts and open risks

- Q21 DEFERRED: supply chain and SBOM gap must close before regulated use; with GxP strict always on this is a release blocker for the regulated release, not for development.
- Q20: owner overrode "later"; full tracing now adds redaction and retention obligations and must respect immutable audit and sensitive-field rules (12 Q12/Q13).
- Q24: wipe of the pilot discards pilot data; acceptable only because ids are stable from day one and no migration is promised; contradicts any module expecting migrated pilot data (13 Q11 migration tool was removed).
- Q27: maintenance windows only, owner overrode graceful drain; a crash can still leave Intent events without Outcome, so inferred outcomes (14 Q7) remain possible.
- Q7: shared RWX storage unproven until the spike passes; fallback weakens multi-instance sharing.
- Q4: availability numbers are examples ("e.g."); the target is not yet fixed and backup owner assignment is not recorded.
- Q9 and Q27 together mean schema changes are expand-contract but deploys are windowed; rollback story must be documented.
- Q14/Q11 introduce mTLS and DB audit logging that depend on supplier assessment still to be done.
- 14 Q8 and 15 Q7 add operational dependencies: Postgres is the notification authority; no break-glass access if the IdP is unavailable.

## Update from authentication review
- NTP-synced server clock with an alert on drift above 1 s is a regulated requirement (auth R5).
- Daily IdP baseline check and drift report run as scheduled jobs (auth Q45, T5); outage of the IdP is an incident with a manual procedure (auth R7).

---

# Open Questions


Status: spec is `needs-info`; the deployment target, the shared filesystem and the backup owner are all undecided, yet the spec already promises N BFF instances and a production start gate.
Biggest risks: availability theatre (N BFF instances on one of everything else), readiness that turns a Novu hiccup into a full outage, no restore path for records kept "forever", and single-process assumptions that survive in background workers.
Every question carries an example, 2-4 options, a recommendation and the prior decision it challenges.

## Q1 [Domain] Validating a system whose deployment target is undecided
Computerised-system validation (installation, operational and performance qualification) is performed against a defined environment. The spec leaves Docker host versus Kubernetes open, but it changes the runner, the filesystem, the secret mechanism and the failure modes, so nothing can be qualified yet. Every month of delay is a month of scientists building on an unqualified base.
Example: the pilot site validates on a single Docker host in Q1; Q3 the company mandates Kubernetes and the IQ/OQ evidence is void for the new environment.
Options: (a) pick one target now for the first regulated release and declare the other unsupported; (b) support both and validate both, doubling the qualification; (c) target Kubernetes with a documented single-host Compose profile for development only.
Recommendation: (c); the N-instance and RWX requirements are already Kubernetes-shaped.
Challenges: "Target (single Docker host, Kubernetes, both) is undecided"; "decide target first".

## Q2 [Domain] "No backup for now" cannot coexist with "retain everything forever"
ADR 0004 removed backups on the grounds that Mice has no data to preserve, and the cross-cutting spec keeps all records until deleted. Once a regulated user stores one signed merge or audit event, the premise fails, and Part 11 11.10(c) and Annex 11 clause 7.2 require records to be protected and restorable throughout their retention period. A deferral with no date is a decision to lose records on the first disk failure.
Example: the first GxP study loads 3 TB of imaging in week 2; in week 5 the volume fails and there is nothing to restore, including the immudb trail that proved who loaded it.
Options: (a) define the minimum backup contract now (what, how often, who owns, tested restore) and defer only the tooling; (b) declare the first release non-GxP and gate regulated use on backup readiness; (c) leave open.
Recommendation: (b) if the date is unknown, otherwise (a); either way write down the gate.
Challenges: "Backup and restore deferred"; ADR 0004 "backups removed for now".

## Q3 [Impl] A consistent restore across PostgreSQL, immudb, Novu's database, oxen data and the shared filesystem
Six stores hold related facts: authorization and Jobs in PostgreSQL, the trail in immudb, notification state in MongoDB, versioned data in oxen, workspace and job trees on disk, and the search index derived from PostgreSQL. Each has its own backup mechanism and point in time. Restoring them to different moments produces audit events that reference commits that no longer exist, or data with no audit.
Example: oxen is restored to Tuesday 02:00 and immudb to Tuesday 14:00; a merge recorded in the trail at 11:00 points at a head that oxen has never heard of.
Options: (a) define an ordered, quiesced snapshot procedure with a manifest of heads and sequence numbers, and reconcile on restore; (b) treat oxen plus PostgreSQL as primary and rebuild everything else; (c) rely on storage-level snapshots of all volumes at one time.
Recommendation: (a), with a post-restore reconciler pass that reports every divergence as an auditable event.
Challenges: "Backup and restore deferred"; "reconciler re-queries oxen to infer outcome" (the same reconciler will meet restored state).

## Q4 [Domain] N BFF instances on a single PostgreSQL and a single immudb
The spec requires several BFF instances for availability, while "HA of databases" is out of scope. Every request requires PostgreSQL and (under strict) immudb, so the platform's availability is that of its least available single component and the BFF replicas add cost without adding availability. The owner may believe the BFF is the weak point when the databases are.
Example: the PostgreSQL pod is rescheduled for 4 minutes during a node drain; all three BFF replicas return 503 for 4 minutes, exactly as one replica would.
Options: (a) state the actual availability target (for example 99.5% with a 4h RTO) and add replicas only where they help; (b) add managed PostgreSQL with failover and keep one immudb with fast restart; (c) keep as is and document.
Recommendation: (a) first; without a target the choice between (b) and (c) cannot be justified.
Challenges: "As an operator, I want to run N BFF instances"; "HA of databases" out of scope.

## Q5 [Impl] Readiness that goes red on any dependency can remove every instance at once
The spec wants the readiness endpoint to go red on any dependency outage so the load balancer stops traffic. If Novu or the search engine is down, every instance reports red simultaneously and the balancer removes them all, taking down reads, workspaces and Jobs that do not need notifications. The existing readiness already covers the audit store and disk, and fail-closed is only required for the ones that gate mutations.
Example: Redis behind Novu restarts at 10:03; all four BFF instances go unready for 90 seconds and 60 scientists lose an upload in progress.
Options: (a) split into liveness, readiness (PostgreSQL, immudb, disk) and a "degraded" report for Novu and search, which do not gate traffic; (b) all dependencies gate readiness as specified; (c) readiness only reflects the instance itself.
Recommendation: (a).
Challenges: User story 3, "/readyz to go red on any dependency outage".

## Q6 [Impl] The single-process guards that must be replaced, and what replaces them
The spec says every single-process guard (the data-directory lock, in-process leases) must be replaced with database or filesystem coordination, but it does not list them or state the semantics. The lock today is a file holding a process id, which is meaningless across hosts. Workspace state, leases and the queue-resume logic assume one writer.
Example: two instances both resume queued Jobs at boot and both launch the same container because each saw the queue entry as unclaimed.
Options: (a) inventory every guard, then use PostgreSQL leases with fencing tokens for each; (b) use advisory locks only; (c) use file locks on the shared filesystem.
Recommendation: (a); file locks on network filesystems are the least reliable option.
Challenges: "Multi-instance requires replacing every single-process guard."

## Q7 [Impl] Overlay mounts on the shared filesystem are unresolved but they drive the choice of filesystem
Workspaces use overlay mounts for cheap copy-on-write trees, and whether this works on a network RWX volume is an open spike. Stock overlayfs does not support NFS as the upper or lower layer in many configurations, and cloud RWX filesystems behave differently in latency for many small files. The decision determines the filesystem, the workspace design and the Kubernetes storage class.
Example: the spike passes on NFS in the lab but fails on the production CSI driver with "stale file handle" errors under 20 concurrent Stages.
Options: (a) time-box the spike with explicit pass criteria (N concurrent Stages, p95 latency, crash recovery) and a named fallback (copy, or node-local scratch with sync); (b) assume it works; (c) drop overlay and always copy.
Recommendation: (a), with node-local scratch as the pre-agreed fallback.
Challenges: "shared RWX filesystem for trees with overlayfs-on-RWX unresolved".

## Q8 [Domain] Docker socket runners in production
Mounting the host container socket into the BFF is equal to host root, and the spec only says "where possible" to avoid it. Both Docker and Kubernetes runners are required, which means the weaker, socket-based option remains available to anyone who deploys on a single host. A GxP security reviewer will treat that as an unacceptable privilege path for a system holding regulated data.
Example: a Job image with a container escape runs on the same host as the BFF with the socket and reads the PostgreSQL secrets.
Options: (a) the socket runner is development-only and the production gate rejects it; (b) allow only through a restricted socket proxy that permits a small API subset; (c) support both and document the risk.
Recommendation: (a), consistent with the Keycloak-dev-only rule.
Challenges: "Docker+Kubernetes runners"; "keep the socket off the BFF where possible".

## Q9 [Impl] Schema migrations with a rolling deploy of several instances
Migrations apply at boot from a single baseline. With N instances starting together, two may attempt the same migration, and during a rolling upgrade the old version runs against the new schema. The spec has no expand/contract rule, no downgrade path, and no statement about which version of the web client and the Node-only CLI may talk to which BFF.
Example: version 1.3 drops a column that 1.2 instances still read; during a ten-minute rollout, 1.2 pods return 500 for every Job query.
Options: (a) migrations run as a single pre-deploy step under an advisory lock, with expand-then-contract across two releases; (b) migrations at boot under an advisory lock; (c) downtime window for every upgrade.
Recommendation: (a), and record the migration and rollback rule in an ADR.
Challenges: "Database maintenance and migrations are the database containers' operations".

## Q10 [Impl] The production start gate relies on a variable that the stack does not even set
The gate refuses dev defaults only when the production mode variable is set, and the shipped Compose does not set it. An operator who forgets it starts a "production" system with the dev secrets and disabled TLS verification, with no error. The plan wanted rejection of several more settings and of unpinned images, but the spec only restates a generic story.
Example: Compose goes live with the default session secret left in place, and the process starts with no error.
Options: (a) invert the default so the gate applies unless an explicit development flag is set; (b) require production mode and fail fast in the packaged images; (c) keep as is.
Recommendation: (a), with the gate's rejection list in the spec and in a start-gate test per rule.
Challenges: "As an operator, I want the BFF to refuse to start with dev defaults"; the production gate coverage.

## Q11 [Domain] Operators can read and alter the databases directly; where is the separation from admins?
Whoever operates the PostgreSQL, immudb and filesystem layers can change authorization rows or Job records without passing through the BFF, so nothing is audited. Annex 11 and Part 11 expect controls so that an operator cannot alter records without detection. Immudb gives tamper evidence for the trail but not for relational state.
Example: a DBA fixes "a wrong role" by updating a membership row directly; no trail entry exists and the next audit finds the change by accident.
Options: (a) separate operator and application roles, direct writes forbidden by policy and detected through periodic comparison of relational state to the trail; (b) database audit logging forwarded to an external system; (c) document as an SOP.
Recommendation: (a) plus (b) for production.
Challenges: Operations spec silent on operator access; "audit trail in immudb" covers only application events.

## Q12 [Domain] Timestamp integrity: "document NTP" is not a control
The spec says the NTP requirement is documented, but ALCOA "contemporaneous" depends on clocks actually being correct on every instance, in immudb, and in runner nodes. Different components stamp the same event, so skew between the BFF, the database and immudb makes the trail internally inconsistent.
Example: instance 2's clock is 3 minutes slow; a revocation stamped 10:00 by instance 2 sorts before a request at 10:01 by instance 1, which the revocation should have blocked.
Options: (a) single authoritative time from the database for ordering, plus a skew check at startup and in readiness; (b) rely on infrastructure NTP and document; (c) hybrid logical clocks.
Recommendation: (a).
Challenges: User story 10 and "documented NTP requirement".

## Q13 [Impl] Secrets from a secret manager and rotation with N instances
Secrets are today environment variables or file-mounted values. Rotating the Session secret on several instances either signs out everyone or requires dual-key support the spec does not mention. Database passwords, the Guacamole encryption key and the Novu credentials all rotate on different schedules.
Example: a leaked secret is rotated at 15:00 and instances restart one by one, so users bounce between instances with different keys and are logged out repeatedly.
Options: (a) a key-ring design with current and previous keys, and an owner and schedule for each secret; (b) full restart with forced sign-out; (c) manual.
Recommendation: (a) for the Session key at least.
Challenges: "secrets supplied by a secret manager" without rotation semantics.

## Q14 [Domain] The oxen server is an unauthenticated third-party component that the whole platform trusts
oxen-server has no authentication, and the BFF's start gate only checks that the upstream address looks internal by name. In a cluster, any pod that can reach it can read or write all repositories with no audit, and the image is currently pulled by a moving tag. As the supplier of the system of record it needs a supplier assessment and a version-control process.
Example: a compromised Job container on the same cluster network calls the upstream directly and deletes a branch; the trail is silent.
Options: (a) network policy allowing only the BFF to reach oxen, a pinned digest, and a supplier assessment; (b) mutual TLS with a sidecar that authenticates the BFF; (c) rely on a private network.
Recommendation: (a) plus (b) if the Kubernetes target is chosen.
Challenges: "As an operator, I want pinned image tags"; the address check as security.

## Q15 [Impl] Background workers run once, per instance, with no ownership rules
Besides requests, the BFF runs a notification worker, an audit verification schedule, startup recovery of queued Jobs and provisioning, and (per the cross-cutting decisions) the Intent/Outcome reconciler. With N instances each would run everywhere. Duplicates cause double notifications, double Job launches and two reconcilers racing to write different Outcomes for one Intent.
Example: two reconcilers each find Intent 8841 with no Outcome; one infers "applied" and the other "not applied" because oxen changed between their reads.
Options: (a) lease-based single active worker per kind with fencing; (b) partitioned work by hash with row claims (`SKIP LOCKED`); (c) a separate worker deployment with one replica.
Recommendation: (b) for queues, (a) for the verifier and reconciler.
Challenges: User story 4 with no worker model; "reconciler re-queries oxen".

## Q16 [Impl] Authentication state that lives in a process breaks behind a load balancer
Login flows (the PKCE state and nonce), CLI device codes, CSRF material and any rate limiting must be readable by whichever instance gets the next request. If any of it is in process memory, then the first redirect back from the IdP will fail on a different instance, and it will pass in a single-instance test.
Example: the user starts login on instance 1 and the IdP callback lands on instance 2, which has no record of the state and answers "invalid state".
Options: (a) inventory all in-process state and move it to PostgreSQL with expiry; (b) sticky sessions at the balancer; (c) signed, stateless cookies for transient state.
Recommendation: (a) with (c) where practical; avoid (b) because it hides defects.
Challenges: "run N BFF instances behind a load balancer".

## Q17 [Impl] Streaming large datasets through a BFF behind a load balancer
All repository traffic passes through the BFF proxy. Datasets are multi-gigabyte, but the spec states no limits, buffering policy or timeouts. A balancer with default timeouts and a proxy that buffers a request body will fail uploads, or exhaust memory with several simultaneous uploads.
Example: three scientists upload 25 GB archives; each BFF pod buffers part of the stream and is OOM-killed at its 2 GB limit mid-upload.
Options: (a) streaming only with explicit body, idle and total timeouts and published limits; (b) direct-to-storage signed uploads bypassing the BFF; (c) keep as is.
Recommendation: (a), and a load test with defined sizes as a release criterion.
Challenges: New gap; "extra oxen read+lock before and after every mutation" adds to the cost.

## Q18 [Impl] No performance targets, so no way to know what "N instances" must achieve
There are no stated users, request rates, dataset sizes or latency budgets, although the cross-cutting decisions add extra oxen reads, locks, audit appends in immudb and the search index to every mutation. Without numbers the design cannot be sized, and "fail closed" thresholds (timeouts) cannot be chosen.
Example: a push of 10,000 small files each becomes a mutation with Intent, two head reads and an Outcome, so 30,000 additional round trips at 20 ms is 10 minutes of overhead.
Options: (a) fix target numbers (100 concurrent users, 50 mutations per second, p95 of 500 ms overhead) and test them; (b) defer until the pilot; (c) tune reactively.
Recommendation: (a) with numbers owned by the owner, even rough ones.
Challenges: Absence of non-functional requirements.

## Q19 [Impl] Client address, proxy trust and rate limiting behind the balancer
Audit events and rate limits need the true client address, but behind a balancer that arrives in a forwarded header that any client can forge unless the BFF trusts only specified hops. The plan listed proxy trust and rate limiting as gaps and the spec drops them.
Example: an attacker sends a forged forwarded address on a login attempt and the audit trail records an internal address, hiding the source.
Options: (a) explicit trusted-proxy configuration, with failing start when production lacks it; (b) trust the last hop only; (c) record both the socket address and the forwarded value.
Recommendation: (c) now and (a) as part of the gate.
Challenges: Dropped plan gaps "proxy trust, rate limiting".

## Q20 [Domain] Observability that an auditor and an operator can both use
The spec asks for logs and metrics suitable for monitoring. Current logs are unstructured, have no request id, and the audit trail is explicitly not an operational log. Without a correlation id between a failed request and its Intent event, diagnosing "Intent without Outcome" requires guessing. Logs can also contain personal data and tokens.
Example: a user reports "my merge failed" and the operator finds three instances' logs with no common identifier and a PAT prefix printed in an error.
Options: (a) structured logs with request id carried into the Intent event, redaction rules, and retention stated; (b) logs unchanged with metrics only; (c) full tracing.
Recommendation: (a) now, (c) later.
Challenges: User story 9, with no content or retention rules.

## Q21 [Impl] CI, image build and supply chain
The authentication image is a development target that installs packages at start from a mounted source tree, and CI does not build or publish images or check dependencies. The spec says production images must not install at start, but nothing says who builds, signs, scans and records them, and GxP release records must tie a running image to a reviewed commit.
Example: an inspector asks which commit produced the BFF image that served last March; there is no digest-to-commit record.
Options: (a) CI builds immutable images tagged by digest, produces an SBOM and a signature, and release notes list digests; (b) tags only; (c) built on the target by operators.
Recommendation: (a).
Challenges: User story 6 without a pipeline.

## Q22 [Impl] A CI matrix with two instances, five containers and a search engine
Tests must run against real containers, and multi-instance behaviour needs at least two BFFs. The existing browser suite uses one worker and stops after the first failure and needs a running stack. Adding PostgreSQL, immudb, Novu with MongoDB and Redis, and a search engine will push the stack past what a hosted CI runner holds comfortably.
Example: the full run takes 55 minutes and fails randomly when a runner runs out of memory with the search engine at its default heap.
Options: (a) tiered pipelines: fast stack-free-as-possible checks per commit, full two-instance suite nightly and before release; (b) all tests on every commit; (c) a persistent test environment.
Recommendation: (a), with the release gate pinned to the full suite.
Challenges: "Multi-instance behaviour is tested by running at least two BFF instances"; "tests use real containers".

## Q23 [Domain] "Retain forever" has a disk bill, and nobody owns cleanup
Records, job logs, outputs and failed-job outputs are kept until deleted, and there is no default expiry. Capacity planning, quota and alerting are not covered, and the readiness check reports only whether the disk is writable. Abandoned workspace directories and expired leases accumulate with no owner.
Example: after 14 months the shared volume reaches 100%; every Job fails, readiness flips red and the oldest, least valuable logs sit beside the newest data.
Options: (a) per-namespace quotas, usage reporting and an alert at 80%, with manual deletion as the only reclamation; (b) tiered cold storage for old logs; (c) retention policies, reversing the owner's decision.
Recommendation: (a) now and revisit (c) with the privacy question.
Challenges: "retention forever"; "failed-job outputs stay in workspace".

## Q24 [Impl] Reaching production from the current stack: nothing to preserve, but identifiers to introduce
The owner treats the system as having no data to preserve, but the cross-cutting spec introduces a stable repository id, a Stage naming and permission migration and a new search index. Any environment that has been used, including the pilot, would need these backfilled, and the migration of audit references is impossible because the trail is immutable.
Example: 40 repositories in the pilot get ids on upgrade, but old audit events reference only names, so a pre-upgrade rename breaks the link between old and new events.
Options: (a) declare a cut-over: ids assigned once and old events resolved through a mapping table recorded in the trail; (b) wipe the pilot; (c) assign ids lazily on first touch.
Recommendation: (a), written as a migration runbook with a rehearsal.
Challenges: "Mice has no data to preserve" (ADR 0004); "stable repo id".

## Q25 [Impl] A dedicated search engine adds a stack component to every deployment
OpenSearch or Meilisearch is a derived index. It adds memory, a rebuild procedure, a version to pin, a security surface and a drift risk against PostgreSQL. The operator story in the spec never mentions it, though the stack is already PostgreSQL, immudb, MongoDB, Redis, Novu API and worker, oxen, guacd, BFF and web.
Example: after a failed upgrade the index is empty; a rebuild of 4 million metadata records takes 6 hours and search returns nothing for that time.
Options: (a) pick the lighter engine, define a rebuild SLA and a "search unavailable" degraded mode; (b) use PostgreSQL full text and defer a separate engine; (c) as decided.
Recommendation: (b) until a measured need, otherwise (a).
Challenges: "dedicated search engine as a derived index".

## Q26 [Impl] Health endpoints: depth, cost and exposure
Liveness is static and readiness probes dependencies. Each readiness call from several balancers and a monitoring system hits immudb and PostgreSQL, and flapping dependencies cause oscillation. The endpoint also exposes which dependency is failing to anyone who can reach it.
Example: a monitoring tool probes every 2 seconds from five locations on four instances: 10 immudb pings per second for monitoring alone.
Options: (a) cached dependency results refreshed in the background, details only for authenticated operators; (b) as is; (c) separate internal and external probes.
Recommendation: (a).
Challenges: User story 3, readiness semantic; existing readiness behaviour.

## Q27 [Domain] Failure of an instance during a mutation: what do operators and auditors see?
Terminating an instance (a rolling update, an out-of-memory kill) between the Intent and the Outcome is routine in Kubernetes, not exceptional. Each such event leaves an Intent that the reconciler must resolve by inference, and the auditor sees a number of "inferred" outcomes proportional to the deployment frequency.
Example: each of 14 weekly deploys terminates about 3 in-flight mutations, so 150 inferred outcomes a year appear in an audit report.
Options: (a) graceful drain with a shutdown deadline that lets in-flight mutations finish, plus a report of inferred outcomes; (b) accept and explain in the validation plan; (c) deploy only in maintenance windows.
Recommendation: (a), and track the inferred-outcome rate as an operating metric.
Challenges: User story 4 (reconciler) as the only mechanism for crash handling.

## Q28 [Impl] Verifying multi-instance behaviour without fault injection
The decision is to test only through the HTTP boundary against real containers, with at least two instances. That cannot create the cases operators fear: killing an instance between steps, partitioning one instance from immudb, or restoring a stale volume. Without such tests the claims about fail-closed behaviour and recovery are unverified.
Example: the suite passes on happy paths while a crash after the Intent but before the proxy call leaves a Job in a state no test ever produced.
Options: (a) add a fault-injection harness (container pause and kill, network cut) at the same boundary for a short list of scenarios; (b) in-process failure hooks; (c) manual game days only.
Recommendation: (a).
Challenges: "Single seam: the BFF HTTP boundary" for failure-mode behaviour.

## Decisions log

| Q | Answer | Date |
| --- | --- | --- |
| Q1 | Kubernetes for first regulated release; Compose dev-only; others unsupported | answered |
| Q2 | Inherited: backup contract hard start gate (04) | answered |
| Q3 | Ordered quiesced snapshot + manifest; post-restore reconciler; rehearsed | answered |
| Q4 | State availability target first (e.g. 99.5%/4h RTO) | answered |
| Q5 | Split liveness/readiness/degraded | answered |
| Q6 | Inventory guards; Postgres leases + fencing | answered |
| Q7 | Time-boxed spike with pass criteria; fallback copy/node-local scratch | answered |
| Q8 | Dev-only socket; prod uses separate runner service behind restricted proxy | answered |
| Q9 | Pre-deploy migration under advisory lock; expand-contract; ADR | answered |
| Q10 | Invert default; dev flag; rejection list; per-rule start-gate tests | answered |
| Q11 | Operator/app roles; periodic comparison; external DB audit logging | answered |
| Q12 | Authoritative DB time + skew checks | answered |
| Q13 | Key-ring, owner+schedule | answered |
| Q14 | NetworkPolicy + pinned digest + supplier assessment + mTLS sidecar | answered |
| Q15 | SKIP LOCKED queues; lease+fencing verifier/reconciler | answered |
| Q16 | Move auth state to Postgres; stateless cookies; no sticky | answered |
| Q17 | Streaming with timeouts, limits, load test criterion | answered |
| Q18 | Fixed targets tested (p95 overhead <=250ms) | answered |
| Q19 | Record socket+forwarded; trusted-proxy config gate | answered |
| Q20 | Full tracing now (owner overrode 'later'); request id into Intent; redaction; retention | answered |
| Q21 | DEFERRED (supply-chain/SBOM gap must close before regulated use) | answered |
| Q22 | Tiered pipelines; full suite release gate | answered |
| Q23 | Quotas + usage + 80% alert; manual deletion | answered |
| Q24 | Wipe pilot (no migration; ids from day one) | answered |
| Q25 | Inherited: Postgres FTS first | answered |
| Q26 | Cached health deps; details to operators | answered |
| Q27 | Maintenance windows only (owner overrode graceful drain; inferred outcomes still possible on crash) | answered |
| Q28 | Fault-injection harness at boundary | answered |

---

# Known Issues and Conflicts

## Supply chain and SBOM gap
- **Q21 DEFERRED: supply chain and SBOM gap must close before regulated use**: With GxP strict always on, this is a release blocker for the regulated release, not for development. Container image provenance, SBOM, and vulnerability scanning are required for Part 11/Annex 11. Deferred but documented as pre-regulated-use requirement.

## Observability and tracing
- **Q20 (owner overrode "later"decision)**: Full tracing now. Adds redaction and retention obligations. Must respect immutable audit and sensitive-field rules (12 Q12/Q13). Traces stored with scrubbing; retention aligned with audit retention (forever, 00 Q8).

## Pilot data wipe
- **Q24 (wipe of pilot discards pilot data)**: Acceptable only because stable ids exist from day one and no migration is promised (16 Q24). Contradicts any module expecting migrated pilot data. 13 Q11 migration tool was removed (authentication Q80).

## Maintenance windows and graceful drain
- **Q27 (maintenance windows only, owner overrode graceful drain)**: A crash can still leave Intent events without Outcome, so inferred outcomes (14 Q7, reconciler) remain possible. No graceful drain means active work interrupted. Accepted operational gap.

## Shared RWX storage unproven
- **Q7 (shared RWX storage unproven until spike passes)**: Fallback weakens multi-instance sharing. 08 Q1 (overlay-on-RWX spike) is unresolved. If spike fails, copy-based or node-local scratch degrades performance and complicates multi-instance coordination.

## Availability targets and backup
- **Q4 (availability numbers are examples "e.g.")**: Target not yet fixed. Backup owner assignment not recorded. Must define SLO for audit store (immudb), Main database, and BFF. Impacts 03 Q5 (QA alert threshold), 15 Q18 (notification timing).

## Schema changes and deploy strategy
- **Q9 and Q27 together**: Schema changes are expand-contract but deploys are windowed (no graceful drain). Rollback story must be documented. A failed deploy with schema mid-migration needs recovery procedure.

## Supplier assessment and dependencies
- **Q14/Q11 (mTLS and DB audit logging)**: Depend on supplier assessment still to be done. PostgreSQL, immudb, Novu, Kubernetes, oxen-server all need documented assessment before regulated use (04 T6, authentication R6).

## Operational dependencies added
- **14 Q8 and 15 Q7**: Postgres is notification authority (14 Q8). No break-glass access if IdP unavailable (15 Q7/authentication R7). Both create operational dependencies that affect incident response.

## Authentication review updates
- **NTP-synced server clock with alert on drift above 1s**: Regulated requirement (authentication R5). Operationally enforced; alert routed to security admins.
- **Daily IdP baseline check and drift report**: Run as scheduled jobs (authentication Q45, T5). Outage of IdP is an incident with manual procedure (authentication R7), not automated fallback.

# Impact on Other Specs

## Blocks or dependencies
- **Blocks all specs requiring infrastructure**: Deployment target (Q1, Q7), Kubernetes configuration (Q1/16 Q1), backup/restore (Q4/04 Q16/16 Q2), monitoring and alerting (Q5, Q6), and supply chain (Q21) are cross-cutting operational requirements.
- **Blocks 01 (Authentication)**: NTP-synced clock (authentication R5), IdP baseline check (Q45, T5), back-channel logout (authentication Q65), directory sync are operational features.
- **Blocks 03 (Audit)**: immudb availability target (Q4/03 Q5), backup (Q4/04 Q16), scheduled verification (Q17/03 Q12), immudb pinning (Q11/03 Q11).
- **Blocks 08 (Workspaces)**: Shared RWX storage (Q7/08 Q1 spike). Overlay viability determines Workspace implementation.
- **Blocks 14 (Notifications)**: Novu or replacement (Q8). Supplier assessment (Q14). Postgres as notification authority (14 Q8).
- **Blocks 15 (Administration)**: Break-glass declined (Q7/15 Q7). IdP outage procedure (authentication R7). No emergency local accounts.

## Depends on
- **Depends on 00 (Cross-cutting)**: Deployment target undecided (Q1/00 Q1). GxP strict always on (Q10). Absolute fail-closed (Q27/00 Q3).
- **Depends on 01 (Authentication)**: IdP as qualified supplier (authentication R6). Clock sync (authentication R5). Back-channel logout, directory sync (authentication Q1, Q2).
- **Depends on 03 (Audit)**: Immudb backup and replication (Q4/03 Q17). Scheduled verification (Q17/03 Q12). Fail-closed on audit outage (00 Q3/03 Q2).
- **Depends on 04 (GxP Compliance)**: Backup as start gate (Q4/04 Q16). Supply chain/SBOM (Q21/04 T6). Validation pack (Q26/04 Q26).
- **Depends on 16 (Operations)**: All operational questions are in this spec (16). Kubernetes production target (Q1/16 Q1). Maintenance windows (Q27).

## Cross-cutting impacts
- **00 (Cross-cutting)**: Deployment target (Q1/00 Q1). Maintenance windows (Q27/00 Q23). Absolute fail-closed (Q27/00 Q3).
- **01 (Authentication)**: NTP clock (authentication R5). IdP checks (authentication Q45, T5, R6). Back-channel logout (authentication Q65).
- **03 (Audit)**: Immudb backup (Q4/03 Q17). Availability target (Q4/03 Q5). Scheduled verification (Q17/03 Q12).
- **04 (GxP Compliance)**: Backup (Q4/04 Q16). Supply chain (Q21/04 T6). Validation (Q26/04 Q26).
- **08 (Workspaces)**: Shared RWX storage (Q7/08 Q1). Overlay spike (08 Q1) determines viability.
- **09 (Jobs)**: Kubernetes runner (Q1/09 Q11). Backup (Q4). Supplier assessment (Q14).
- **14 (Notifications)**: Novu (Q8). Postgres authority (14 Q8). Supplier assessment (Q14).
- **15 (Administration)**: Break-glass declined (Q7/15 Q7/authentication R7). IdP outage incident response (authentication R7).
- **16 (Operations)**: This spec IS operations (16). All decisions here impact deployment, monitoring, backup, and incident response.

