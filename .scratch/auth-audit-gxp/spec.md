Status: done (slices 1-5 implemented; uncommitted until the user says commit)

## Problem Statement

The audit trail in `plans/03-audit.md` is meant to be GxP-grade evidence of who changed what dataset, when, and why. Today it is a plain `audit.jsonl` written after the upstream response. A crash, a full disk or an edit to the file leaves no evidence, nothing detects tampering, mutations carry no reason, dataset versions before and after a change are not recorded, and the log still has a rewrite path. Auditors cannot rely on it, and operators cannot prove it is complete.

## Solution

The audit trail becomes tamper-evident, complete by construction, and always on (there is no GxP-off mode):

- Every event is hash-chained, the file is append-only, and the chain is verified at boot and on a schedule.
- A mutation is written as an intent event before it reaches oxen and as an outcome event after. If the audit store cannot be written, the mutation is refused with 503.
- Every dataset mutation needs a reason. The BFF defaults it from the commit message when one exists, and otherwise requires an explicit reason. Service principals use a registered fixed reason.
- Dataset mutations record the dataset version before and after, or an explicit `unverified` marker.
- Signed checkpoints and a signed export bundle let a third party verify the trail. A broken chain blocks mutations until an operator acknowledges it with an audited action.

## User Stories

1. As an auditor, I want every audit event chained to the previous one, so that an edited or deleted event is detectable
2. As an auditor, I want the chain verified at boot and on a schedule, so that tampering is found without anyone asking
3. As an auditor, I want signed checkpoints made with a key outside the data volume, so that someone who can rewrite the volume cannot rewrite history undetected
4. As an auditor, I want the audit store to be append-only, with no rewrite path, so that history cannot be altered through the application
5. As an auditor, I want to know a mutation was attempted even if the system crashed mid-request, so that the trail is complete
6. As an operator, I want a mutation refused with 503 when the audit store cannot be written, so that no change happens without a record
7. As an operator, I want a readiness check on the audit store and chain, so that I find out before users do
8. As an operator, I want a failed chain verification to block dataset mutations until I acknowledge it, so that a broken trail is never silently extended
9. As an operator, I want my acknowledgement of a broken chain recorded as an audited event, so that the decision itself is traceable
10. As an operator, I want boot to refuse a non-empty unchained `audit.jsonl`, so that no history is silently adopted or rewritten
11. As an operator, I want boot to fail when the checkpoint signing key is missing, so that checkpoints are never skipped
12. As an auditor, I want every checkpoint to carry a key id, and old public keys to stay available, so that past checkpoints stay verifiable after rotation
13. As a scientist, I want my commit message used as the reason for my change by default, so that I am not asked twice
14. As a scientist, I want a clear 400 telling me to lengthen my commit message or pass a reason when it is too short, so that I know how to proceed
15. As a CLI user, I want a `--reason` flag, so that I can state a reason for changes that have no commit message
16. As an API caller, I want an explicit reason to override the commit message and both to be stored, so that the narrative and the justification are both kept
17. As an auditor, I want each event to say whether its reason was explicit or taken from the commit message, so that I can judge its weight
18. As an operator of a service principal, I want a registered fixed reason per principal, so that automated jobs are not blocked by a missing human
19. As a security reviewer, I want a mutation with no reason rejected by the BFF before it reaches oxen, so that the rule cannot be bypassed from a client
20. As a security reviewer, I want admin and permission changes to need a reason too, so that changes to who may touch data are justified
21. As a user, I want logins, token management and announcements not to ask for a reason, so that routine actions stay quick
22. As an auditor, I want each dataset mutation to record the dataset version before and after, so that I can reconstruct the data state
23. As an auditor, I want an explicit `unverified` marker when the after version cannot be determined, so that gaps are visible and not hidden
24. As an auditor, I want the real acting identity, the credential type and a bypass flag on every event, so that site-admin bypass and service principals are attributable
25. As a data protection officer, I want it documented that audit events keep personal data and are never erased, so that the retention position is explicit
26. As an instance admin, I want audit read access limited as it is today, so that personal data in the trail is not widened
27. As an auditor, I want exports to be logged with who exported which range, so that disclosure of the trail is itself traced
28. As an auditor, I want an export to be one signed bundle of events, covering checkpoints, the verification result and the public key, so that it is evidence and not just a spreadsheet
29. As a maintainer, I want the audit interface (append, query, verify) fixed above the JSONL log, so that swapping the store does not change chain semantics
30. As a security reviewer, I want raw oxen to be unreachable except through the BFF, so that no mutation can avoid the audit
31. As a maintainer, I want deny-path e2e tests for each rule, so that a regression fails CI

## Implementation Decisions

Vocabulary follows `GLOSSARY.md`. ADR 0001 (identity trust) and ADR 0002 (default-deny) are preserved; this spec does not re-open them.

**Audit module**
- One audit module with a small interface: append an intent, append an outcome, query, verify, export. The chain lives above the existing JSONL log seam, so a later store swap keeps the same semantics.
- Every event stores `prev_hash` and `hash` (SHA-256 over canonical JSON). Appends are serialised by one writer so the chain cannot fork. Reading the last hash and appending happen under one lock.
- The rewrite path in the audit store is removed.
- The chain starts at a genesis event. The existing log is assumed empty. Boot refuses a non-empty `audit.jsonl` that has no hashes.
- Events keep `sub`, `iss`, email and name inline, and are never erased. Retention is indefinite until a documented period is set.

**Completeness**
- Dataset and admin mutations write an intent event before forwarding and an outcome event after. If the intent cannot be written, the BFF returns 503 and nothing reaches oxen.
- A readiness check covers the audit store and chain state.
- BFF-native mutations that change data or access follow the same intent and outcome rule.

**Integrity**
- Signed checkpoints (last hash and event count) are written daily and on shutdown, with an Ed25519 key supplied through the environment or a secret mount, kept outside the data directory. Boot fails if the key is missing. Every checkpoint carries a key id, and public keys for old key ids are retained.
- Verification walks the chain and checkpoints, reports the first break, and runs at boot and on a schedule. A break fails readiness and blocks dataset mutations until an operator acknowledges it. The acknowledgement is an audited event.

**Reason**
- A reason is mandatory for every dataset mutation (file write or delete, commit, merge, branch, repo create or delete, workspace commit and merge) and for admin and permission changes. Logins, token management and announcements are exempt.
- Missing or too-short reasons are rejected with 400 at the BFF before the request reaches oxen. The minimum length is a single setting. The reason is free text and is only recorded.
- Where a commit message exists in the request, the BFF uses it as the reason by default. An explicit reason overrides it, and both are stored. Each event records `reason_source` as `explicit` or `commit-message`. The BFF owns this rule, so web and API callers behave like the CLI.
- The CLI adds `--reason`. API callers send the reason in a request field or header. Service principals have a registered fixed reason.
- There is no change-control id field.
- Slice 3 is a breaking API change for CLI and PAT users. It is announced and the CLI version is bumped.

**Dataset versions**
- Dataset mutations record `{ base, head }` commit ids, taken from lineage capture. When `head` cannot be determined, the event carries an explicit `unverified` marker.

**Actor identity**
- Events record the real acting identity, the `via` credential type, and `bypass: true` for site-admin bypass. Service principals are identified as such.

**Access and export**
- Audit read access is unchanged: instance admins, `view_audit` holders, and namespace owners for their own namespace. Plain reads are not audited. Exports are audited with the requester and range.
- An export is a signed bundle of the events, covering checkpoints, the verification result and the verification key. CSV remains as a convenience view.

**Deployment invariant**
- Raw oxen is unreachable except from the BFF network. This is documented as an invariant and checked in e2e.

**Delivery order** (each slice leaves the system working)
1. Chained, append-only audit with genesis, verification and boot refusal of an unchained log.
2. Intent-first fail-closed writes, the 503 and the readiness check.
3. Mandatory reason with commit-message default, `reason_source`, the CLI flag and service-principal reasons.
4. Dataset `{ base, head }` versions and the `unverified` marker.
5. Signed checkpoints, key ids, the signed export bundle, and the failed-verification block with audited acknowledgement.

## Testing Decisions

- A good test drives behaviour through the interface a client or operator uses and does not inspect internals. The audit tests assert on what a verifier or auditor can see: events, verification results, status codes, and what reached the fake upstream.
- **Seam 1 (highest): the app built by `createApp` with a fake upstream and an in-memory persistence backend.** Mutation, reason, 503, readiness, export and acknowledgement behaviour are all tested here with `app.request`. It catches policy and wiring errors and misses real disk and network behaviour.
- **Seam 2: the audit module interface (append, query, verify) over the memory backend.** Chain, tamper detection, checkpoint and key-rotation behaviour are tested here. It catches integrity logic errors and misses HTTP concerns.
- **Seam 3: the existing e2e stack for deny paths**, as a TC-AUDIT series beside TC-DENY: a mutation without a reason is rejected before oxen, an unwritable audit store returns 503 and nothing reaches oxen, a tampered `audit.jsonl` fails verification and blocks mutations, and the raw oxen port is unreachable from outside the BFF network.
- Use the existing seams: `isolatedAuth`, the `jsonStore` memory backend, `setUpstreamFetch`, the `Clock` seam for checkpoint schedules, and `overrideEnv`. Prior art: the proxy, audit and lineage tests, and `e2e/tests/deny-paths.spec.ts`.
- The CLI gets unit tests for `--reason` and for the message shown when a commit message is too short.

## Out of Scope

- A change-control id or any external change-control system integration.
- WORM storage and external anchoring of checkpoints.
- Audit erasure or pseudonymisation of actors.
- Moving audit to Mongo or Postgres (the interface is prepared for it, the swap is not done).
- Multi-instance shared audit.
- Auditing raw oxen on `:3001` directly. Instead it is made unreachable.
- Making reads auditable.

## Further Notes

- The "audit log is empty" assumption was given by the user and is enforced at boot rather than relied on.
- Annex 11 §9 and FDA and MHRA data-integrity guidance expect a reason for changes and deletions. The user chose a reason for every dataset mutation, which is stricter than that.
- Open item to confirm during slice 3: which proxied mutation routes carry a commit message, so the default applies exactly where it can.


## Outcome notes

- Commit messages are read from JSON and multipart bodies via `extractMessageFromJson`/`extractMessageFromForm`; other mutating routes (deletes, branch ops, workspace unstage) have none and need an explicit reason.
- Fixed on the way: the body classifier rejected the all-string path array that web sends on `DELETE /workspaces/:id/changes|files`; it now passes on exactly those routes.
