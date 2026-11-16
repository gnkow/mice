# 23: Repository collaborator entity versions

**What to build:** Adding, changing role of, or removing a repository collaborator appends entity version history, and the repository collaborators UI shows the historic view. Separate from Audit and from namespace membership history (ticket 22).

**Blocked by:** None (can start immediately)

**Status:** done (API acceptance; UI historic view out of deep-api)

## Acceptance

- [x] Collaborator add / role change / remove each append version history
- [x] Prior collaborator states remain readable and unchanged
- [ ] Repository collaborators UI shows chronological entity history _(UI out of deep-api)_
- [x] HTTP tests reconstruct collaborator state across changes without reading the Audit trail

## Comments

- **Deep-api Deepen (2026-11-16):** Top — `appendVersionInterval` wired into `recordCollaboratorVersion`. HTTP: `repoCollaboratorVersions.test.ts`. Status done (API); UI gap noted.
