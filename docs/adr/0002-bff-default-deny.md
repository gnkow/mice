---
status: accepted
---

# The BFF denies by default: unclassified paths, non-canonical paths and un-enforced production

oxen-server has no ACL, so the BFF's decision for each proxied request is the only authorization. We make every gap fail closed: all unclassified routes are denied. Production refuses to start unless a bootstrap admin is configured, the data directory is writable, and the oxen upstream is internal. Authorization is always enforced. GET/HEAD paths that are not on an explicit allowlist and carry no namespace and repo are denied. Unknown mutating routes require repo Admin. Paths with encoded separators, dot escapes, double slashes or malformed escapes are rejected with `400`, so the path that is authorised is exactly the path that is proxied. Push transport routes (commit upload, publish, version chunks) are authorised as Write; the version query is Read. Oxen is reachable only on the internal network; the base compose publishes no port.

## Considered options

- Allow unrecognised GETs for any signed-in Principal: simpler for new oxen routes, but a new route can leak data before anyone classifies it.
- Add a sidecar or shared secret between the BFF and oxen-server: defence in depth, but a new component and moving parts. Not needed while the network is private; revisit if oxen is ever co-hosted with untrusted workloads.
- Normalise instead of reject non-canonical paths: friendlier, but two parsers can still disagree. Rejecting is simpler to reason about.

## Consequences

- New oxen routes are unreachable (GET) or Admin-only (mutating) until classified in the path table.
- Deployments that set `NODE_ENV=production` must set `AUTHZ_BOOTSTRAP_ADMINS` and keep oxen on an internal address.
- Staging (oxen's own workspaces) and Mice Workspaces stay at the repo-role floor here; per-feature rules belong to those feature plans.
