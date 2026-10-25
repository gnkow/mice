Status: needs-info
Blocked on: deployment target (Docker host vs Kubernetes vs both); backup owner (deferred).

# 16 — Deployment, state and operations (PLAT-OPS)

## Problem Statement

Operators need a production deployment that is safe by default, runs several BFF instances, and does not depend on dev conveniences, but the target platform is not chosen.

## Solution

Containerised production stack (PostgreSQL, immudb, Novu with MongoDB and Redis, search engine, BFF, web) with pinned images, a production start gate, health endpoints and an external IdP.

## User Stories

1. As an operator, I want the BFF to refuse to start with dev defaults, so that insecure configs never ship.
2. As an operator, I want pinned image tags, so that oxen-server API changes are deliberate.
3. As an operator, I want `/readyz` to go red on any dependency outage, so that traffic stops.
4. As an operator, I want to run N BFF instances behind a load balancer on shared storage.
5. As an operator, I want an external IdP, with Keycloak only for dev.
6. As an operator, I want production images that do not install packages at start.
7. As a security reviewer, I want the Docker socket kept off the BFF where possible (socket proxy or Kubernetes runner).
8. As an operator, I want secrets supplied by a secret manager.
9. As an operator, I want logs and metrics suitable for monitoring.
10. As a compliance lead, I want a documented NTP requirement, so that timestamps are contemporaneous.

## Implementation Decisions

- Target (single Docker host, Kubernetes, both) is undecided; this decides whether Docker-socket runners remain supported in production.
- Multi-instance requires replacing every single-process guard (`dataDirLock`, in-process leases) with database or filesystem coordination.
- Shared RWX filesystem for bulk trees; its type depends on the target.
- Backup and restore, retention and rotation are deferred; revisit when the target is decided.
- Database maintenance and migrations are the database containers' operations (ADR 0004).
- Non-atomic disk writes for jobs and aliases move into PostgreSQL.

## Testing Decisions

- Start-gate tests for dev-default rejection; two-instance e2e; outage tests for readiness.
- Prior art: existing readiness tests.

## Out of Scope

Backup/restore, HA of databases, retention.

## Further Notes

Decide target first; several stories change under Kubernetes.
