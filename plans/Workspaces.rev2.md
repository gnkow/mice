# WORKSPACES — BFF-owned remote working trees (rev 2)

> # ⛔ SUPERSEDED — DO NOT IMPLEMENT FROM THIS FILE
> Replaced by [Workspaces.md](./Workspaces.md) (rev 3: overlay + checkout store). Kept for history only; nothing here is tracked or approved. Where this file and Workspaces.md differ, **Workspaces.md wins**.
>
> Points that conflict with Workspaces.md (do not implement):
>
> | Rev 2 (this file) | Rev 3 ([Workspaces.md](./Workspaces.md)) |
> | --- | --- |
> | Storage: `AUTH_DATA_DIR/workspaces/<id>/tree` cloned per workspace, Docker **host-path bind** (`WORKSPACES_HOST_DATA_DIR`) | Overlay (`upper` over a shared per-commit checkout) on two Docker **named volumes** (`mice-store`, `mice-workspaces`), §2; host paths only resolved from `docker volume inspect` |
> | Create = full clone via `materializeCommitClone` | `ensureCheckout` incremental, hardlinked, single-flight (§3); create copies nothing |
> | Phases **W0–W6** (W0 store … W6 remove Oxen usage) | Phases **W0–W7** with different contents (W0 spike, W1 checkout store, W2 workspace store, W3 leases, W4 commit builder, W5 jobs/sessions, W6 CLI/UI, W7 Kubernetes), §12. Do not map rev 2 numbers onto them |
> | Kubernetes: RWX PVC `WORKSPACES_PVC` | Not in this iteration; `copy`/`reflink` driver meanwhile, overlay is W7 (§4.3) |
> | Manifest cache `manifest.json` in `<id>/`, live diff by re-hashing the tree | Diff from `upper` + manifests, never walking the lower tree (§5.1, I2) |
> | `/api/repos/*/workspaces/*` "stays reachable but unused" | Oxen workspaces are renamed **Stages** and remain a separate, supported feature; see route ownership below |
>
> **Route ownership:** `/auth/workspaces/**` and `/auth/checkouts/**` belong to Mice workspaces (Workspaces.md §9). Oxen's own `/api/repos/:ns/:repo/workspaces/**` is proxied by the BFF and owned by **Stages** (formerly Staging; see [Staging.md](./Staging.md)); it is not deprecated or removed by Workspaces.md, and Mice workspaces never use it except transiently as the commit builder (§7.1). Rev 2's "ignored/unused" wording is void.

Replaces the use of **Oxen workspaces as a user concept** everywhere in Mice. A Mice workspace is a persistent, writable directory on a shared volume holding a **working tree cloned from a branch/commit**, which Sessions and Jobs **mount**. Oxen is only the versioned store (clone in, commit out).

Why: an Oxen workspace is a staging area reachable only through HTTP (base commit + staged DB; bytes live in the version store). It cannot be mounted, and edits to a mounted copy never show up as changes. See [Jobs.md §13](./Jobs.md), [Sessions.md §11](./Sessions.md).

Rev 2 fixes the flaws found in review of rev 1 (admission-only exclusivity — now simplified to single-writer/many-readers, non-atomic/removal-less commits, racy base advance, host-path mounts, local jobs, security of untrusted writers).

## 1. Core invariant

> **`tree == base_commit snapshot + changes`**, where *changes* are the differences shown by the live diff. Every operation (commit, update, reset) must preserve this, per path.

State per workspace (`workspaces.json` + `<id>/state.json`): `id`, `kind: user|auto`, `name`, `namespace`, `repo`, `branch` (merge target), `base_commit`, `created_by/at`, `updated_at`, `op` (`idle|committing|updating|resetting`, with `op_id`), `quota_bytes`.
Manifest (`<id>/manifest.json`, outside the tree): `path → {size, mtime_ns, sha256}` cache of the tree, and `<id>/base.json`: `path → {sha256, oxen_hash}` of the base snapshot.

## 2. Decisions (locked)

> Confirmed by the user: the job **writes directly into the workspace** (no scratch copy); the workspace is **always frozen** (single writer) while a job runs; a failed/cancelled job's partial output **stays in the workspace** until the user resets or deletes it; sessions get a **read-only live view**.

| Topic | Choice |
| --- | --- |
| Oxen workspaces | Never used as storage or exposed. Used **only transiently** as a commit builder (§5), deleted right after |
| Storage | `AUTH_DATA_DIR/workspaces/<id>/tree` on a shared volume. Docker: bind mount from the **host path** `WORKSPACES_HOST_DATA_DIR` (new compose bind, same mapping rule as `JOBS_HOST_DATA_DIR`). Kubernetes: RWX PVC `WORKSPACES_PVC`; single-node dev may use `hostPath` (documented) |
| Create | From branch or commit: clone via Oxen HTTP (existing `materializeCommitClone`), writing `base.json`. Quota enforced while cloning (abort + cleanup) |
| Changes | **Live**, from the manifest cache: re-hash only files whose `(size, mtime_ns, ctime)` changed, and always re-hash files modified in the last 2 s (mtime granularity) |
| Commit | Explicit **Commit changes** (UI/CLI); jobs auto-commit on success. One **atomic** Oxen commit on a safe branch, then merge into the target (§5) |
| Update from branch | Three-way (base ↔ target head ↔ tree), all-or-nothing, needs the `write` lease (§4) |
| Direct file API | Browse/download/archive always allowed (live read). Upload/delete/move need the `write` lease (423 otherwise) |
| Existing Oxen workspaces | Ignored; no migration. `/api/repos/*/workspaces/*` stays reachable via the proxy but unused by Mice (documented) |
| Names | Unique per repo. `kind:auto` workspaces are named `job-<id>`/`session-<id>`; those prefixes are **reserved** for auto kinds |

## 3. Security of an untrusted tree

Containers and sessions are untrusted writers into a directory the BFF reads:

- **Never follow symlinks.** Scan with `lstat`; symlinks, devices, FIFOs, sockets are reported as *special* (shown, never read, never committed). Every file-API path is resolved and must stay under the tree's realpath (reject `..`, absolute paths, symlinked ancestors). Prevents reading BFF files through a planted symlink. Scans skip entries on a different device.
- Containers run `--user ${WORKSPACES_UID}:${WORKSPACES_GID}` (default = BFF uid:gid), umask `0002`, so the BFF can always read/delete what they create. Sessions use the same ids.
- No `.oxen` dir in the tree; job markers live in `<id>/`, not `tree/`.
- Quotas: `WORKSPACES_MAX_BYTES` per workspace, `WORKSPACES_MAX_TOTAL_BYTES`, file-count cap. Enforced on create/upload and checked on lease release (over quota → no new leases + banner; a running job is never killed).

## 4. Access model: one writer, many live readers

The goal: **a session can watch a job's outputs in real time without being able to change (and therefore corrupt) the computation.**

| Role | Who | Rules |
| --- | --- | --- |
| **Writer** (at most one) | A running job, a session mounted read-write, or the API (file ops / commit / update / reset) | Holds the single `write` lease. All other writers wait or are refused |
| **Reader** (any number) | Sessions mounted `ro`, UI file browser, archive download | Hold a `read` lease (informational) — **always allowed, even while a job writes** |

- **Read-only is enforced by the platform, not by trust:** a reader session's mount is a Docker bind with `:ro` (k8s `readOnly: true`), so nothing inside the guest can write, rename or delete. The BFF file API refuses writes without the `write` lease (423, naming the holder).
- **Live view:** job detail gets **Open live view** → starts (or reuses) a session with this workspace mounted `ro` at `/data/<ns>/<repo>`, plus a live Files/Changes tab and log tail in the UI. New files appear as the job writes them.
- **Honest consistency:** readers see files as they are on disk, so a file the job is still writing can be partial. Jobs that need atomic output should write temp + rename; the UI marks files modified in the last few seconds as *in progress*. A reader can never alter the job's inputs or outputs.
- **Writer acquisition:** `write` is granted only when no other `write` lease exists. A job that cannot get it is `queued` with `wait_reason: {holder}`; `JOBS_WAIT_TIMEOUT_SEC` (3600) then `failed: workspace busy`; `wait:false` → 409 naming the holder. While a job is waiting, **no new read-write session mounts** are admitted (no starvation); read-only sessions still are.
- **A session asked for `rw` but the workspace is busy:** it starts `ro` with a visible banner (never silently), and cannot be upgraded while the writer exists; when the writer ends the user may restart it `rw`.
- **No concurrent writers:** removes last-write-wins races, mid-commit edits by other writers, and the multi-writer admission edge cases of rev 2. Parallel computation uses separate workspaces (default `auto`) or `workspace_mode: ro` jobs (read-only jobs take `read`, may run in parallel).
- **Enforcement honesty:** the single-writer rule is admission control for writers; read-only is enforced at the mount. Host-level writers on the volume are out of scope (advisory).

**Release:** holder terminal status; TTL (`timeout + JOBS_LOCK_GRACE_SEC` for jobs; session leases renew while running); **reconciliation** at BFF start and every 60 s (holder gone/terminal → release; interrupted non-CLI jobs → `failed: interrupted`; `op != idle` → recovery §5); admin force-release (audited).
**Multi-mount sessions:** leases acquired **all-or-nothing in sorted `workspace_id` order**; partial failure releases what was acquired.
**Tamper check:** at job start `tree_hash` (incremental, bounded by `WORKSPACES_HASH_TIMEOUT_SEC`) must equal the value recorded at lease grant, else `failed: workspace changed before start`.

## 5. Commit, update, reset (operation state machine)

`op` and `op_id` are persisted before any step; each step is idempotent so recovery can resume.

### Commit (atomic, supports deletions)

1. The caller must hold the `write` lease (job auto-commit and a read-write session's user already do; otherwise an implicit short `write` lease is taken, 423 if someone else holds it). Each file is hashed **while streamed**; a path that changed mid-commit (writer still running) is excluded and stays a change.
2. Compute the diff vs `base.json` (added / modified / removed; specials ignored).
3. Create safe branch `mice/ws/<id>-<seq>` at `base_commit` (jobs: `mice/job/<id>`).
4. **Commit builder:** create an *unnamed ephemeral Oxen workspace* on that branch (head == `base_commit` by construction; verify `workspace.commit.id`), stage added/modified via workspace upload, stage removals, then **one** workspace commit. Oxen deletes an unnamed workspace after commit. Result: **a single atomic commit including removals**, with Oxen's own conflict check. (Alternatives rejected: `PUT /file/<branch>/<dir>` commits one directory per call and `DELETE /file` one removal per call — non-atomic.)
5. Merge the safe branch into the target via the existing merge call. Conflict → outcome `conflict` (commit kept on the safe branch and listed to the user).
6. **Advance base per path:** `base_commit := safe-branch commit`; `base.json` takes the *committed* hash of each committed path (from the stream), so mid-commit edits remain changes. The invariant holds because that commit is exactly `old base + committed paths`.
7. `op := idle`, audit `workspace.commit`. **Recovery:** safe branch head ≠ `base_commit` and carrying the `op_id` in its message → finish step 6; no commit → roll back (delete safe branch, `op := idle`).

Job lineage fields (`result_branch`, `result_commit`, merge status) are unchanged; workspace commits keep a `commits` list in `state.json`.

### Update from branch

Needs the `write` lease. Upstream changes = base ↔ target head (by `oxen_hash`, skipping identical subtrees via directory hashes). Paths not touched locally are applied; paths changed on both sides are **conflicts**. All-or-nothing: with conflicts → 409 `{conflicts:[…]}` and nothing changes, unless `resolve: {path: "ours"|"theirs"}` covers each. On success `base_commit := head`; "ours" paths remain local modifications. Files staged in a temp dir and swapped by atomic rename; `op` recovery as above.

### Reset

Needs the `write` lease. Restores files differing from `base.json` and removes extras. Idempotent.

## 6. API (auth BFF; session or PAT)

| Route | Authz | Behavior |
| --- | --- | --- |
| `POST /auth/workspaces` | repo write | `{namespace, repo, name?, source}` |
| `GET /auth/workspaces?namespace&repo` | repo read | List (+ change counts from cache, leases) |
| `GET /auth/workspaces/:id` | repo read | Detail, leases, `op`, `behind` |
| `DELETE /auth/workspaces/:id` | repo write | 423 while a `write` lease exists |
| `GET …/changes` | repo read | Live `{added, modified, removed, special}` |
| `POST …/commit` | repo write | `{branch?, message, paths?, snapshot?}` → `{commit, merge}` or conflict |
| `POST …/update`, `POST …/reset` | repo write | §5 |
| `GET/PUT/DELETE …/files/*`, `POST …/move`, `GET …/archive` | read / write | Tree ops; `archive` streams tar.gz; PUT supports tar apply (local jobs) |
| `POST/GET/DELETE …/leases`, `POST …/leases/:id/renew` | `read` lease: repo read; `write` lease: repo write; force-release: admin | Lease lifecycle (`mode: read|write`) |

**AuthZ:** add `/auth/workspaces/**` to the authz path map (GET → read, mutations → write, force-release → admin) under custom-role resource `workspaces`; session read-write mount needs repo write, `ro` needs read; re-checked at lease grant and at connect.
**Audit:** `workspace.create/delete/commit/update/reset`, `workspace.lease.acquire/release/force_release`.

## 7. Consumers

- **Sessions:** mount = lease on the tree (no copy, baseline, `sync`, `mount-diff`). Docker bind (`:ro` for readers, rw only for the single writer) at `/data/<ns>/<repo>`. **Live view of a running job = a `ro` session on the job's workspace.** Existing sync/mount-diff code and routes are removed.
- **Cluster jobs:** workspace = selected or auto `job-<id>`; `write` lease (or `read` for `workspace_mode: ro`); tree bind-mounted at `workdir` (no per-job clone); on exit 0 → §5 commit; failure/cancel → tree left as is, nothing committed, diff visible. Auto workspace deleted only when auto **and** succeeded **and** merged (or empty diff); otherwise kept **until the user deletes it** (no automatic GC). See [Jobs.md §13](./Jobs.md).
- **Local (laptop) jobs:** a laptop cannot mount the server volume. `mice job run --workspace <id>`: take the `write` lease (TTL + renew) → download `…/archive` into the local job dir → run Docker locally → upload only changes via tar apply (+ removal list) **under the lease** (laptop jobs are not live-viewable; the tree is untouched until apply) → server runs the §5 commit → release. Without `--workspace` nothing changes.
- **CLI:** `mice workspace create|list|show|delete|changes|commit|update|reset|ls|get|put|rm|mv|leases|unlock`.
- **Web:** Workspaces list/detail rebuilt: Changes, Files (live), Jobs, Sessions, Leases; writer/waiting pills; job detail **Open live view**; commit/update/reset dialogs; session mount picker with mode.

## 8. Phases (each shippable with tests)

- [ ] **W0** Store, create-from-source (quota), manifest cache, live changes, symlink-safe file API, delete/reset
- [ ] **W1** Leases, writer preference, 423 enforcement, reconciliation, audit, authz map
- [ ] **W2** Commit builder (ephemeral Oxen workspace), merge, op state machine + recovery, update-from-branch. *Starts with a spike against the real Oxen server*
- [ ] **W3** Jobs on workspaces (host-path bind, uid/gid, waiting/timeout, auto workspace + GC, ro jobs, k8s PVC, **live view session**)
- [ ] **W4** Sessions mount rewrite (drop copy/sync/mount-diff)
- [ ] **W5** Local-job archive/apply, CLI `mice workspace`, web UI rebuild
- [ ] **W6** Remove remaining Oxen workspace usage in web/CLI; docs; e2e

## 9. Test plan

| Case | Expectation |
| --- | --- |
| TC-WS-01 | Create from branch → tree equals commit; changes empty; quota abort cleans up |
| TC-WS-02 | Edit via file API / mount → added/modified/removed appear live (incl. same-size edit) |
| TC-WS-03 | Commit → single Oxen commit incl. a deletion on safe branch, merged to target; base advances; changes empty |
| TC-WS-04 | File edited mid-commit stays a change; base hash = committed hash |
| TC-WS-05 | Target moved: non-overlapping → merge OK; overlapping → `conflict`, safe-branch commit kept |
| TC-WS-06 | Update from branch: clean merge; conflicts → 409, tree untouched; `resolve` applies |
| TC-WS-07 | Crash after commit before base advance → recovery finishes; crash before commit → rolls back |
| TC-WS-08 | Single writer: job waits for a busy workspace; no new rw mounts while waiting; timeout → failed; busy-rw session starts `ro` with banner |
| TC-WS-09 | While a job writes: file write / commit / delete / second writer → 423; ro session + GET + archive OK; no-wait → 409 with holder |
| TC-WS-10 | Lease released on job terminal, TTL expiry, restart; force-release audited |
| TC-WS-11 | Tree changed between lease and start → job fails |
| TC-WS-12 | Planted symlink to a BFF file: file API/archive/commit never read it |
| TC-WS-13 | Container-created files deletable by BFF (uid/gid) |
| TC-WS-14 | Cluster job without workspace → `job-<id>`; deleted after merged success; kept (with the failed job's partial output as changes) until the user deletes it |
| TC-WS-15 | Multi-mount session all-or-nothing; partial failure releases leases |
| TC-WS-16 | Session rw edits appear in Changes without any sync |
| TC-WS-20 | **Live view:** ro session on a running job's workspace sees new/updated output files within seconds; every write attempt from the guest (create, rename, delete, chmod) fails with a read-only error; job result is unaffected |
| TC-WS-17 | Local job with `--workspace`: archive down, apply up, commit, lease released |
| TC-WS-18 | AuthZ: read-only user cannot write/commit/take the write lease; unauthenticated 401; custom role honoured |
| TC-WS-19 | UI: create, browse, upload, changes, commit, conflict, writer pill + Open live view during a job |

## 10. Residual risks

| Risk | Mitigation |
| --- | --- |
| Single-writer is admission control; host-level writers | Documented advisory limit; tamper check; read-only enforced at the mount |
| Readers see partially written files | Documented; UI marks recently modified files *in progress*; jobs should write temp + rename |
| Large trees: clone time, disk, hashing | Quotas, incremental manifest cache, hash timeout; sparse/lazy materialize later |
| RWX storage on Kubernetes | Required PVC class; documented single-node `hostPath` fallback |
| Update-from-branch is path-level, not content merge | Conflicts explicit; `ours|theirs` resolution |
| Oxen behaviour (ephemeral workspace commit, merge, listing hashes) unverified | W2 spike first; fallback per-directory `PUT /file` commits, non-atomic caveat documented |
| Big-bang replacement of Oxen workspaces | Phased W0–W6; old UI removed only in W6 |
