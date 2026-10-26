---
status: proposed
---

# Kubernetes is the production target; Compose is development only

## Context

Installation/operational qualification is performed against one defined environment. The spec left Docker host versus Kubernetes open (16 Q1), yet the requirements for N BFF instances, shared storage, secrets and a job runner are already Kubernetes-shaped. Supporting both doubles qualification, and a switch later voids the evidence.

## Decision

- The first regulated release targets Kubernetes. Any other production target is unsupported.
- Docker Compose is a single-host development and CI profile only. It is not qualified and not used for regulated data.
- Jobs run through a separate runner service behind a restricted proxy; the container socket is a dev-only convenience and is never mounted into the BFF in production (16 Q8).
- Oxen stays on an internal network only, as in ADR 0002.
- ADR 0004's "runs the same way locally, in CI and in production" still holds for the databases; only the orchestrator differs.

## Consequences

- IQ/OQ is written once against Kubernetes manifests.
- Developers can still run the stack locally with Compose, so parity between the two profiles must be tested.
- Shared (RWX) storage and the overlay/workspace question must be solved on Kubernetes.
- Operators need Kubernetes skills.

## Alternatives rejected

- Support single Docker host and Kubernetes: double qualification.
- Docker host only: conflicts with multi-instance requirements.
- Leave undecided: nothing can be qualified.
