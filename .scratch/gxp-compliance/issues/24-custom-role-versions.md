# 24: Custom role entity versions

**What to build:** Creating, updating, or deleting a custom namespace or repository role appends entity version history, and the custom-roles UI shows the historic view. Separate from Audit.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Acceptance

- [ ] Custom role create / update / delete each append version history (permissions and metadata as stored on the role)
- [ ] Prior role definitions remain readable and unchanged
- [ ] Custom-roles UI shows chronological entity history
- [ ] HTTP tests reconstruct a role definition across changes without reading the Audit trail
