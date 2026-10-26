---
status: proposed
---

# Oxen repository names are static and keyed by stable id; rename and transfer live in the BFF

## Context

Rename was specified as copy-then-delete in oxen (00 Q7, 05 Q2-Q5). A copy may change commit hashes, which would break every Pin, workspace base commit, lineage reference and checkout, and needs freezing, throttling and a state machine. The owner proposed a simpler approach (05 Q25, confirmed).

## Decision

- Each repository gets a stable id at creation, in one transaction. The physical oxen repository name is derived from that id and never changes.
- User-visible namespace/name are BFF metadata in PostgreSQL. Rename changes that metadata only.
- Transfer between namespaces is also a BFF metadata change (re-pointing the namespace id); it needs source repo Admin plus destination namespace Owner approval, and collaborators are dropped by default (02 Q6). Confirm first that oxen paths do not embed the namespace.
- The BFF translates names to physical keys for API calls and for CLI/clone URLs.
- Grants, favorites and scopes use the repository id; a recreated name gets a new id.

## Consequences

- Commit ids never change on rename or transfer; no copy, freeze or manifest compare is needed.
- Leases and running workspaces are unaffected by rename.
- Name resolution is on every request; the BFF is the only place that knows both names.
- Operators browsing oxen storage see ids, not names; a mapping view is needed.
- Copy-based moves remain only for a future physical relocation.

## Alternatives rejected

- Copy-then-delete rename: risks changed hashes and long freezes.
- Forbid rename: safest but unfriendly to scientists.
- Map old to new name in oxen: still leaves two physical names.
