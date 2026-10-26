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
