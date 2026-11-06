# 23: Repository collaborator entity versions

**What to build:** Adding, changing role of, or removing a repository collaborator appends entity version history, and the repository collaborators UI shows the historic view. Separate from Audit and from namespace membership history (ticket 22).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Acceptance

- [ ] Collaborator add / role change / remove each append version history
- [ ] Prior collaborator states remain readable and unchanged
- [ ] Repository collaborators UI shows chronological entity history
- [ ] HTTP tests reconstruct collaborator state across changes without reading the Audit trail
