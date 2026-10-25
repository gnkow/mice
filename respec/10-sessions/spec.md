Status: ready-for-agent

# 10 — Desktop Sessions (PLAT-SESS)

## Problem Statement

Scientists need a Linux desktop near their data over RDP. Regulated deployments need policy control over clipboard, drives and egress.

## Solution

Provisioned Desktop Sessions with a gateway, lifetime and idle limits, a security policy (clipboard/drive off by default), enforced egress, and optional recording.

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
11. As a compliance lead, I want optional recording with a visible user notice, so that sessions can be reviewed when needed.
12. As an auditor, I want session start, connect, disconnect, stop and policy changes audited.
13. As an operator, I want quotas on session hours.

## Implementation Decisions

- Idle timer starts at disconnect.
- Policy defaults: clipboard and drive off; template owner may relax outside strict; instance admin only under strict.
- Egress is enforced by Docker network or NetworkPolicy; Oxen reachable through the BFF.
- Recording is optional everywhere, including strict; viewers, storage and notice behaviour are to be specified with the feature.
- Gateway: guacd/rustguac default; IronRDP relay is fallback-only pending matrix decisions.
- Auto-recovery scope beyond `failed`/`stopped` and quota units are open and should be decided in implementation.

## Testing Decisions

- HTTP tests of lifecycle and policy enforcement; connection parameters verified at the gateway boundary.
- Prior art: existing sessions e2e.

## Out of Scope

Mandatory recording, IronRDP primary gateway.

## Further Notes

Per-feature clipboard policy cannot be enforced if the gateway cannot parse virtual channels.
