# Mice

Mice is a platform around a self-hosted oxen-server: identity, authorization, audit, versioned jobs, desktop sessions and workspaces.

## Language

### Identity

**Principal**:
The authenticated identity behind a request, keyed by IdP `iss`+`sub`. The IdP guarantees that key is one unique human. Arrives as a Session or a CLI credential.
_Avoid_: Account, caller

**Instance admin**:
A Principal appointed to administer the Mice instance. At least two remain; deletion cannot go below that.
_Avoid_: Owner, superuser, bootstrap admin

**User**:
A human with a profile in Mice. A User is one kind of Principal holder; use Principal when the authentication mechanism matters.
_Avoid_: Member (that is a namespace role)

**Session**:
The sealed browser cookie issued after SSO login.
_Avoid_: Login token, desktop session (see Desktop Session)

**CLI credential**:
A short-lived `mice_cli_*` access token from `mice login`, stored in the OS keychain and refreshed for up to 30 days.
_Avoid_: PAT, personal access token, API key

**BFF**:
The `auth/` service in front of oxen-server that authenticates, authorizes, audits and proxies every request.
_Avoid_: Gateway, auth server

**Author injection**:
The BFF writing the Principal's `iss`+`sub` as a commit's author and the Principal's email at that moment as the commit's email.
_Avoid_: Author override

### Audit

**Audit module**:
The module with `append`, `read range` and `verify` over immudb. Tamper evidence is immudb's verified reads and proofs; there is no hash chain of our own (ADR 0005).
_Avoid_: Chain, ledger, audit store

**Intent event**:
The audit event appended before a mutation reaches oxen or is applied. If it cannot be stored the mutation is refused with 503.
_Avoid_: Pre-log, attempt

**Outcome event**:
The audit event appended after a mutation, carrying the result status and `intent_id` of its Intent event. An Intent event with no Outcome event means the mutation may have started and never completed.
_Avoid_: Result log, completion

### Compute and data

**Workspace**:
A Mice-owned overlay working tree over a shared checkout, mounted by jobs and desktop sessions.
_Avoid_: Oxen workspace, working copy

**Staging**:
Oxen's own server-side staging area, not used by Mice workspaces.
_Avoid_: Workspace

**Desktop Session**:
A dedicated Linux desktop instance a user connects to over RDP.
_Avoid_: Session (alone), VM

**Main database**:
The containerised PostgreSQL that domain stores reach directly through Drizzle, locally, in CI and in production. There is no generic backend seam and no in-memory or file adapter (ADR 0004).
_Avoid_: Persistence seam, JSON store

**Notification service**:
Novu, which owns notification state. The notification worker projects audit events into it.
_Avoid_: Notification store

**Job**:
A container run against a pinned Oxen commit, with lineage and an optional result commit.
_Avoid_: Task, run

**Pin**:
The commit or content hash a Job or Desktop Session is tied to.
_Avoid_: Snapshot, version lock
