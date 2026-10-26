Status: ready-for-agent

# 10 — Desktop Sessions (PLAT-SESS)

## Problem Statement

Scientists need a Linux desktop near their data over RDP. Regulated deployments need policy control over clipboard, drives and egress.

## Solution

Provisioned Desktop Sessions with a gateway, lifetime and idle limits, a security policy (clipboard/drive off by default) and enforced egress. Sessions are never recorded.

## User Stories

1. As a scientist, I want to start a Desktop Session, so that I get a Linux desktop.
2. As a scientist, I want to connect from the browser, so that I need no client.
3. As a scientist, I want to reconnect after a drop, so that work is not lost.
4. As a scientist, I want to stop and retry a failed session.
5. As a scientist, I want a warning before the lifetime ends, so that I can save.
6. As an instance admin, I want unattended sessions suspended or stopped after N minutes from disconnect, so that resources are freed.
7. As a security reviewer, I want clipboard and drive redirection off by default, so that data does not leak.
8. As a template owner, I want to relax those in non-strict deployments, so that my workflow works.
9. As a compliance lead, I want only instance admins to relax them under `GXP_STRICT`.
10. As a security reviewer, I want guest egress enforced by the provisioner, with Oxen via BFF always allowed.
11. As a compliance lead, I want one read-write session per Workspace with lease-holder attribution and off-box auditd records correlated by session id, so that activity is attributable without recording.
12. As an auditor, I want session start, connect, disconnect, stop and policy changes audited.
13. As an operator, I want quotas on session hours.

## Implementation Decisions

- Idle timer is driven by gateway events from disconnect; idle suspends, lifetime stops (disk kept N days), destroy only by user or admin.
- Policy defaults: clipboard and drive off; template owner may relax outside strict; instance admin only under strict. Only gateway-enforceable policies are offered.
- Egress is enforced by Docker network or NetworkPolicy; Oxen reachable through the BFF via a dedicated data-path endpoint.
- Recording of desktop sessions never happens, in any mode (owner decision reversing 00 Q22).
- Kubernetes is the production target, so sessions run as pods; Docker only for single-host dev. libvirt/KubeVirt stubs are dropped.
- Gateway: guacd/rustguac default; IronRDP relay is fallback-only pending matrix decisions.
- Auto-recovery scope beyond `failed`/`stopped` and quota units are open and should be decided in implementation.

## Testing Decisions

- HTTP tests of lifecycle and policy enforcement; connection parameters verified at the gateway boundary.
- Prior art: existing sessions e2e.

## Out of Scope

Recording of any kind, IronRDP primary gateway, libvirt/KubeVirt provisioners.

## Further Notes

Per-feature clipboard policy cannot be enforced if the gateway cannot parse virtual channels.

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Lifecycle
- DB-leased sweeper with CAS transitions; idle derived from gateway events (Q1).
- Generation-column CAS and a state machine table; Intent/Outcome per transition (Q20).
- Lifetime stops (disk kept N days), idle suspends, destroy only by user or admin; 15/5 minute warnings, one extension (Q2).
- One bounded extension, deduplicated warnings, audited (Q22).
- Concurrent-create race left as is, flagged (Q13).
- Guest data outside the mount is not preserved; documented (Q21).

Recording and attribution
- Recording never; supersedes the recording-storage design (Q3, Q4).
- Compensating controls: one read-write session per Workspace with lease-holder attribution, and off-box auditd correlated by session id (Q4, Q10).
- Analysis/review only; no primary capture; stated in the validation scope (Q24).
- Workspace layer is treated as a non-record; commits are required at acquisition, no auto snapshots (Q12).

Policy, security and data path
- Desktop is treated as inside the data boundary and relies on repository authz (Q5).
- Offer only gateway-enforceable policies; conformance test; guest lockdown (Q6).
- Dedicated guest-facing data-path endpoint with a session-scoped desktop principal (Q9).
- One-time per-connect guest credential, never stored (Q19).
- Sensitivity label; block mixing; deny read-write plus restricted read-only; admin exceptions (Q28).
- Stateless signed tickets; drain docs; reconnect grace (Q7).

Templates, gateway, platform
- Versioned immutable admin-owned templates; version and digest on the session (Q15).
- Gateway has a named owner, pinned digests, SBOM, patch SLA; qualification is an entry criterion (Q8).
- Durable gateway event queue; reconciler polls; "observed" marker; never fail closed for observations (Q16).
- Pods under Kubernetes, Docker if single-host; libvirt/KubeVirt stubs dropped (Q14).
- Read-only Workspace mounts until the 08 spike, then a mount abstraction (Q26).
- Nightly protocol conformance plus per-PR parameter assertions; recording tests dropped (Q25).

## Conflicts and open risks

- Q4 OVERRODE 00 Q22 and 04 Q22 (recording mandatory for GxP-touching Sessions); those logs and specs still say mandatory. Regulatory risk: no primary capture, accepted by owner.
- Q13: concurrent-create race remains, "as is".
- Q21: guest outside-mount data loss, "as is", documented only.
- Q14: now resolved by 16 Q1 (Kubernetes); the pod provisioner is the target, Docker dev-only.
- Q26: depends on the 08 spike (overlay-on-RWX); fallback copy/node-local scratch.
- Q5: no separate threat model for the desktop; relies on repo authz (accepted risk).
- Q12 and 08 Q2: Workspace layer is non-record and transient; loss risk is stated.
- Q18 and 01 Q20: revoke terminates Sessions; Q17 no break-glass.
- Q8: qualification entry criterion for the gateway is not yet scheduled (PENDING).
