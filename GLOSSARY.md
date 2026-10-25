# Mice

Mice is a platform around a self-hosted oxen-server: identity, authorization, audit, versioned jobs, desktop sessions and workspaces.

## Language

### Identity

**Principal**:
The authenticated identity behind a request, keyed by IdP `iss`+`sub`. Arrives as a Session or a PAT.
_Avoid_: Account, caller

**User**:
A human with a profile in Mice. A User is one kind of Principal holder; use Principal when the authentication mechanism matters.
_Avoid_: Member (that is a namespace role)

**Session**:
The sealed browser cookie issued after SSO login.
_Avoid_: Login token, desktop session (see Desktop Session)

**PAT**:
A `mice_pat_*` personal access token used by CLI, Python and automation, with optional scopes.
_Avoid_: API key, bearer token

**BFF**:
The `auth/` service in front of oxen-server that authenticates, authorizes, audits and proxies every request.
_Avoid_: Gateway, auth server

**Author injection**:
The BFF overwriting commit author name and email from the Principal's IdP claims.
_Avoid_: Author override

### Audit

**Chain**:
The audit log as a sequence of events where each stores `prev_hash` and `hash` (SHA-256 over canonical JSON), starting at a genesis event. Editing or removing an event breaks it at that point; verification reports the first break.
_Avoid_: Signature, ledger

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

**Job**:
A container run against a pinned Oxen commit, with lineage and an optional result commit.
_Avoid_: Task, run

**Pin**:
The commit or content hash a Job or Desktop Session is tied to.
_Avoid_: Snapshot, version lock
