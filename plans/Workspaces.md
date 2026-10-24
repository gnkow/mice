# WORKSPACES — overlay working trees over a shared per-commit checkout store (rev 3)

A **Mice workspace** is a persistent, writable filesystem view of a repo at a branch/commit that Sessions and Jobs **mount**. It is built from two parts:

- a **shared, immutable per-commit checkout** (the *lower layer*), downloaded once and reused by every workspace of that repo; and
- a small **per-workspace changes directory** (the *upper layer*), holding only what was added, modified or deleted.

Creating a workspace copies nothing. Disk grows only with changes. The full tree (all files, always) is available to every consumer.

> Rev 3 supersedes rev 2 (`Workspaces.rev2.md`): scratch/clone-per-workspace is replaced by overlay + checkout store. Oxen's own server-side workspaces are **not** used; they move to a separate, later feature — see [Staging.md](./Staging.md). Jobs: [Jobs.md §13](./Jobs.md). Sessions: [Sessions.md §11](./Sessions.md).

User decisions carried forward (locked):

| # | Decision |
| --- | --- |
| D1 | BFF-owned workspaces replace Oxen workspaces everywhere in Mice; no migration |
| D2 | Overlay layout; **all files of the commit are always available** (no sparse/lazy initialization) |
| D3 | **One writer, many readers.** The job writes directly into the workspace; the workspace is **always frozen** (no other writer) while a job runs |
| D4 | Sessions get a **read-only live view** of a running job's workspace; a reader can never alter the computation |
| D5 | A successful job's result **overwrites/becomes** the workspace content (in-place writes + auto-commit, §7); a failed/cancelled job's partial output **stays** until the user resets/deletes it; no automatic cleanup |
| D6 | Explicit **Commit changes** from UI/CLI; jobs auto-commit; live diff against the base |
| D7 | File API in UI and CLI; local (laptop) jobs take the lease through the BFF |

## 1. Concepts and invariants

```
checkout(commit)   immutable, shared, read-only      store/commits/<ns>/<repo>/<commit>/tree
upper(ws)          the workspace's changes           workspaces/<id>/upper
view(ws)           what consumers see (kernel overlay of upper over a checkout)
logical base(ws)   commit + manifest the *diff is computed against*  (state.json + base.json)
physical lower(ws) the checkout the overlay is currently mounted on  (state.json: lower_commit)
```

- **I1 (view):** `view = upper ⊕ physical_lower` (overlayfs semantics: files in upper win, whiteouts delete, opaque dirs hide lower content).
- **I2 (diff):** `changes = diff(view, logical_base)`. Computed only from `upper` plus the manifests (never by walking the lower tree).
- **I3 (rebase pending):** `physical_lower` may be older than `logical_base` (after a commit, before the overlay is remounted). Every path where `physical_lower ≠ logical_base` **must be present in `upper`** (the committed files are still there). This lets a commit complete without remounting a live overlay; compaction (§6.3) later removes the redundancy.
- **I4 (immutability):** a checkout is never modified after it is published. Overlay `lowerdir` is read-only by construction; nothing writes through it.

State (`workspaces/<id>/state.json`): `id`, `kind: user|auto`, `name`, `namespace`, `repo`, `branch` (merge target), `base_commit` (logical), `lower_commit` (physical), `gen` (overlay generation), `status: preparing|ready|error`, `op` (`idle|committing|updating|resetting|compacting`, `op_id`), `quota_bytes`, `created_by/at`, `updated_at`. `base.json`: logical base manifest `path → {size, sha256, oxen_hash}` (copied from the checkout's manifest; small).

## 2. Storage layout

Two **Docker named volumes** (not host bind paths), so it works unchanged on Linux and on Docker Desktop (macOS), where overlay cannot sit on a host-shared folder:

| Volume | Mounted in BFF at | Holds | Why separate |
| --- | --- | --- | --- |
| `mice-store` | `AUTH_DATA_DIR/store` | `blobs/`, `commits/`, `tmp/` | Hardlinks require blobs and commit trees on **one** filesystem |
| `mice-workspaces` | `AUTH_DATA_DIR/workspaces` | `<id>/{upper,work,state.json,base.json,changes-cache.json}` | Overlay `upperdir`+`workdir` must share a filesystem; keeps user data separate from the cache |

Constraints (checked by a capability probe at startup, §11): both volumes on **ext4 or xfs (with d_type)**; kernel **≥ 5.11** (`userxattr`); not NFS/CIFS/virtiofs. The dockerd-side path of each volume is resolved with `docker volume inspect --format '{{.Mountpoint}}'` (override: `WORKSPACES_HOST_STORE_DIR` / `WORKSPACES_HOST_WS_DIR` for Linux bind setups).

```
store/
  blobs/<aa>/<sha256>                      immutable file contents, mode 0644, owner WORKSPACES_UID
  commits/<ns>/<repo>/<commit_id>/
      tree/…                               hardlink farm into blobs/ (dirs 0755)
      manifest.json                        path → {size, sha256, oxen_hash};  dirs → dir_hash
      meta.json                            created_at, last_used_at, built_from, files, new_bytes, oxen_listing_hash
      READY                                written last; presence = published
  tmp/<build_id>/                          in-progress builds (swept at startup)
workspaces/<id>/…
```

All files are owned by `WORKSPACES_UID:GID` (default = BFF uid). Containers run with the same ids, so copy-up never changes ownership and the BFF can always read/delete.

## 3. Per-commit checkout sync (the core)

`ensureCheckout(ns, repo, commit, opts?) → CheckoutRef` — idempotent, single-flight, incremental, resumable, safe under crash.

### 3.1 Resolution
Input is a branch or commit; the BFF resolves it to the **full commit id** (Oxen revision lookup) first. Everything downstream keys on the commit id, so a moved/force-pushed branch can never alias a checkout.

### 3.2 Fast path
`commits/…/<commit>/READY` exists → touch `meta.last_used_at`, return. No Oxen traffic.

### 3.3 Single flight
Per-key (`ns/repo/commit`) in-memory promise map; concurrent callers await the same build and see the same progress. A `tmp/<build_id>/lock` (pid + heartbeat every 10 s) protects against a second BFF process; a lock without heartbeat for 60 s is stale and the build is adopted or swept.

### 3.4 Incremental build (never "clone everything" when a neighbour exists)

1. **Candidates:** up to 5 `READY` checkouts of the same repo (most recently used first, plus the one whose commit is an ancestor of the target if the commit-history call is cheap). The **known-blob index** = `oxen_hash → sha256` built from all `READY` manifests of the repo (in memory, rebuilt lazily, ~100 B/file).
2. **Walk the target tree** top-down with Oxen's `dir/<commit>/<path>` listing (paged, ≤ `CHECKOUT_LIST_CONCURRENCY` = 8 directories in flight):
   - **Directory prune:** if an entry's directory hash equals the same path's `dir_hash` in a candidate manifest, the whole subtree is *linked* from the candidate (one `link()` per file from its recorded `sha256` blob — no listing, no download).
   - **File known:** `oxen_hash` found in the known-blob index → `link(blob, tmp/tree/<path>)`.
   - **File new:** queue for download.
3. **Download queue** (≤ `CHECKOUT_DOWNLOAD_CONCURRENCY` = 8 streams): stream to `tmp/<build>/.part/<n>` while computing sha256, then `rename` into `blobs/<aa>/<sha>` (or discard if present) and `link` into the tree. Completed blobs are durable immediately, so a retry/resume after a crash or network error **only re-links** and downloads what is still missing. Per file: 3 retries with exponential backoff, `If the size from the listing != bytes received → fail the file`.
4. **Link fallback:** `link()` failing with `EMLINK` (ext4 limit ≈ 65 000 links/inode) → copy that file for this checkout. `EXDEV` cannot happen (single volume) and is a configuration error caught by the probe.
5. **Validation before publish:** file count and total bytes equal the listing totals; no entry name is `.`, `..`, empty, contains `/`, NUL or a backslash; nothing named `.oxen*`; every path stays under `tree/` after normalization; symlink/special entries in the listing are skipped and counted in `meta.skipped`. A failed validation aborts the build and keeps `tmp/` for inspection (swept after 24 h).
6. **Publish:** write `manifest.json` (+ per-directory `dir_hash` taken from Oxen's listing), `meta.json`, then `READY`; `fsync` the directories; **atomic `rename(tmp/<build>, commits/…/<commit>)`**. Readers only ever see complete checkouts. Rename onto an existing directory (lost race) → discard own build, use the winner.
7. **Seeding after a commit:** `opts.seed = {path → {sha256, srcFile}}` lets the BFF ingest the just-committed files (copied once into `blobs/`) so the checkout of the new commit needs **no re-download** of the committed paths (their `oxen_hash` is unknown until listed; the listing then matches by path+size+sha256-from-seed).

### 3.5 Progress and failure behaviour
- Progress `{phase: resolving|listing|downloading|linking|publishing, files_done, files_total, bytes_done, bytes_total}` is stored per build and returned by `GET /auth/workspaces/:id` (`status: preparing`) and `GET /auth/checkouts/:ns/:repo/:commit`; the UI shows a progress bar.
- Workspace creation is **asynchronous**: `POST` returns 202 with `status: preparing`; jobs/sessions wait for `ready` (bounded by `WORKSPACES_PREPARE_TIMEOUT_SEC` = 3600) — queued jobs show `wait_reason: preparing checkout`.
- Oxen unreachable/5xx → build fails retryably; the workspace stays `preparing` with `last_error` and the BFF retries with backoff (1 m, 5 m, 15 m) until the user deletes it; manual `POST …/retry`.
- Disk full → fail with `507`, remove the partial `tmp/`, trigger GC (§3.7) once, then report.

### 3.6 Keeping the store warm ("sync")
- **On demand:** `ensureCheckout` on workspace create / update-from-branch / job start with an unresolved branch.
- **Pre-warm:** for repos that have ≥ 1 workspace or a `prewarm` flag, a poller (every `CHECKOUT_PREWARM_INTERVAL_SEC` = 60) resolves the branch heads listed in `WORKSPACES_PREWARM_BRANCHES` (default: repo default branch + any workspace's target branch) and calls `ensureCheckout` at low priority (1 build at a time, yields to on-demand builds). The BFF also pre-warms immediately after it observes a successful push/commit/merge it proxies. Result: the next workspace creation or update on a fresh head only costs the delta.
- **Manual:** `POST /auth/checkouts` `{namespace, repo, ref}` and `mice checkout warm`.

### 3.7 Garbage collection and integrity
- **References** (never evicted): `lower_commit` and `base_commit` of every workspace, commits of running builds, commits of active leases.
- **Unreferenced** checkouts: keep the newest `CHECKOUT_KEEP_PER_REPO` = 3 and anything used within `CHECKOUT_TTL_DAYS` = 14; delete the rest (rename to `tmp/trash/…` first, then remove).
- **Blobs:** a blob with `st_nlink == 1` (only the store references it) **and** mtime older than 1 h is deleted. GC takes an exclusive store lock; builds hold a shared lock only while linking, so a blob cannot vanish between lookup and link.
- **Watermarks:** if `store` usage > `WORKSPACES_STORE_MAX_BYTES` evict LRU unreferenced checkouts until below 90 %; if still over, new builds fail with 507 and an admin alert (audit `store.full`).
- **Scrub:** weekly + on demand, re-hash a rotating 5 % of blobs against their file name; a mismatch quarantines the blob (`blobs/.bad/`), marks every checkout containing it `corrupt` (refused for new mounts; running ones continue) and rebuilds on next use.
- Admin API/CLI: `GET /auth/checkouts`, `DELETE /auth/checkouts/:ns/:repo/:commit` (409 if referenced), `POST /auth/store/gc`, `mice checkout list|warm|rm|gc`.

## 4. Overlay mounting

### 4.1 Mechanism: Docker volume with overlay options
For workspace `W` generation `g` the BFF creates (once) a volume:

```
docker volume create --driver local --name mice-ws-<id>-g<gen> \
  -o type=overlay -o device=overlay \
  -o o=lowerdir=<host>/store/commits/<ns>/<repo>/<lower_commit>/tree,upperdir=<host>/workspaces/<id>/upper,workdir=<host>/workspaces/<id>/work,userxattr
```

Docker mounts it **once on first use and unmounts when the last container releases it**, and every container using that volume gets a bind of the *same* kernel overlay instance. Consequences:

- A job/rw session mounts it read-write; a live-view session mounts the **same volume read-only** (`readonly`) → coherent live view (new files appear immediately) and the guest cannot write (read-only bind enforced by the kernel).
- No privileged capability for the BFF: dockerd (already root, reachable only by the BFF) performs the mount. No `CAP_SYS_ADMIN` on the auth container.
- Remount with a new lower = new generation volume; the old one can only be removed when no container uses it (`docker volume rm` fails otherwise) — a built-in safety net against pulling the lower layer from under a live mount.

`userxattr` makes overlay markers (`user.overlay.whiteout`, `user.overlay.opaque`) readable by the BFF without privileges (§5.1).

### 4.2 Mount spec abstraction
```
interface TreeDriver {
  prepare(ws): Promise<void>                    // volume create / dirs
  mountArgs(ws, mode: 'ro'|'rw', dest): MountSpec  // docker --mount / k8s volume
  scan(ws): Promise<Changes>                    // §5
  readFile(ws, path): Readable                  // §5.3
  mutate(ws, ops[]): Promise<void>              // §5.4 (helper)
  rebase(ws, newLower): Promise<void>           // §6.3
}
```
Drivers, picked by `WORKSPACES_DRIVER=auto|overlay|reflink|copy` (probe at startup, §11):

| Driver | When | Behaviour |
| --- | --- | --- |
| `overlay` | Linux ≥ 5.11, ext4/xfs volumes, Docker runner | As above. Default |
| `reflink` | btrfs / xfs-reflink / APFS-backed storage | `cp --reflink=always -a` the checkout into `workspaces/<id>/tree` (instant, CoW); diff by manifest |
| `copy` | Anything else (dev fallback) | Full copy of the checkout into `tree/` with a visible warning and `WORKSPACES_COPY_MAX_FILES` guard; diff by manifest |

`reflink`/`copy` use a plain `tree/` directory (bind mount) and a manifest-based diff; the layering invariants I1–I4 map to `tree == base + changes`. They exist so development and unusual hosts work; production assumes `overlay`.

### 4.3 Supported runners
| Runner | Overlay support |
| --- | --- |
| Docker (`JOBS_RUNNER=docker`) and Sessions (Docker) | **Yes** (volume mount, `ro`/`rw`) |
| Kubernetes | **Not in this iteration.** A pod cannot mount overlay without privilege; options (node DaemonSet that owns mounts + CSI-style publish, or fuse-overlayfs in the pod) are documented in §12 and need their own design. Until then Kubernetes uses the `copy`/`reflink` driver on an RWX PVC, and the single-node `hostPath` setup is documented |
| `cli` (laptop) | Not mounted; archive-down / apply-up under the lease (§8) |

### 4.4 Who may mount what
Exactly the lease model of §6.1: a `rw` mount needs the single `write` lease; a `ro` mount needs a `read` lease. The mount spec is produced only after the lease is granted; releasing the lease removes the container first, then the lease.

## 5. Reading and mutating the view without a mount

The BFF cannot mount the overlay (§4.1), so it works from `upper` + checkout, both ordinary directories it can read, and uses a helper for anything that must obey kernel overlay semantics.

### 5.1 `scan(ws)` — compute changes from upper (live diff)
1. Walk `upper/` with `lstat`/`O_NOFOLLOW` (never follow symlinks; skip other devices). For each file: use `changes-cache.json` `{ino, size, mtime_ns}` to skip unchanged files; hash the rest with sha256; **always re-hash files with mtime < 2 s** (granularity, and in-progress writes).
2. Collect overlay markers with **one** `getfattr -R -h -m '^user\.overlay\.' -e hex --absolute-names upper` call (package `attr` in the auth image): `whiteout` ⇒ the path is deleted; `opaque` on a directory ⇒ every base path under it that is **not** present in upper is deleted. Parser is strict (octal-escaped names decoded; unparseable record ⇒ scan error, not a silent skip) and fuzz-tested with names containing spaces, newlines, quotes, unicode.
3. For each upper entry compare with `base.json`:
   - not in base → `added`; sha256 differs → `modified`; equal → **not a change** (copy-up by `touch`/`chmod`/same-content rewrite is ignored);
   - whiteout/opaque-covered base path → `removed`; a whiteout for a path absent in base is ignored.
4. Specials in upper (symlinks, devices, fifos, sockets) are reported as `special`, never read, never committed; empty directories are not tracked by Oxen and are ignored.
5. Output `{added[], modified[], removed[], special[], upper_bytes, files, scanned_at}`; cached `SCAN_TTL = 3 s` per workspace; `upper_bytes` feeds quota (§9).

Cost is **proportional to the size of the changes, not the tree** (the lower tree is not walked).

### 5.2 Effective manifest (browse)
`listDir(ws, path)` merges `base`/physical-lower manifest children with the upper scan (add/override upper entries, drop whiteouts/opaque-covered). Directory browsing therefore needs no filesystem walk of the lower tree.

### 5.3 `readFile` / archive
- Single file: resolve with the effective manifest to **either** `upper/<path>` **or** `store/commits/…/tree/<path>`; open with `O_NOFOLLOW`; verify the resolved realpath is inside that root; stream. Freshness ≤ `SCAN_TTL`.
- Folder/whole-tree archive (`GET …/archive`) must be exactly the kernel's view, so it runs the helper (`wsctl tar`) with the overlay volume **read-only** and streams its stdout (works while a writer is active; readers never block the writer).

### 5.4 `mutate(ws, ops)` via the `wsctl` helper
Upload, delete, move, mkdir, reset and "apply tar" are performed by a short-lived container `docker run --rm --user $UID:$GID --mount <overlay volume rw> $AUTH_IMAGE node dist/wsctl.js <json ops>` (the BFF's own image; no new image), so whiteouts, opaque directories, copy-up and renames are produced **by the kernel**, never hand-crafted in `upper/`. Ops are batched; each op validates paths (no `..`, no absolute, no `.oxen*`, no symlink ancestors) inside the helper as well. Requires the `write` lease (§6.1). Typical latency 0.3–0.8 s per batch.

## 6. Access model, leases, rebase

### 6.1 One writer, many readers
| Role | Who | Rules |
| --- | --- | --- |
| **Writer** (≤ 1) | A running job, a `rw` session, or an API mutation (file ops, commit, update, reset, compaction) | Holds the single **`write` lease**; others wait or get **423** naming the holder |
| **Reader** (any) | `ro` sessions, UI browse/download/archive | **`read` lease** (informational); always allowed, even during a job |

- **Read-only is enforced by the platform:** readers get the volume with `readonly`; the BFF file API refuses writes without the `write` lease.
- **Live view:** job detail → **Open live view** starts (or reuses) a `ro` session mounted at `/data/<ns>/<repo>` + a live Files/Changes tab and log tail. Files modified in the last ~3 s are marked *in progress* (partial writes are visible); the job can write temp + rename for atomicity.
- **Writer acquisition:** granted only if no `write` lease exists. A job that cannot get it is `queued` (`wait_reason`); `JOBS_WAIT_TIMEOUT_SEC` (3600) → `failed: workspace busy`; `wait:false` → 409. While a job is waiting no new `rw` session is admitted (no starvation); `ro` still is.
- **`rw` session on a busy workspace:** starts `ro` with a visible banner; restart `rw` after the writer ends. Parallel compute → separate workspaces (default `auto`) or `workspace_mode: ro` jobs.
- **Multi-mount sessions:** leases acquired all-or-nothing in sorted `workspace_id` order.
- **Release:** holder terminal; TTL (`timeout + JOBS_LOCK_GRACE_SEC` for jobs, renewals for sessions); reconciliation at BFF start and every 60 s (gone/terminal holders → release, interrupted non-CLI jobs → `failed: interrupted`, `op != idle` → recovery §7); admin force-release (audited).
- **Tamper check:** `upper_hash` (hash of scan result incl. markers) recorded at lease grant, verified when the job container starts; mismatch → `failed: workspace changed before start`.
- Enforcement honesty: single-writer is admission control; host-level writers on the volume are out of scope (advisory). Read-only is a mount property.

### 6.2 State machine
`op`/`op_id` persisted before any step; every step is idempotent; recovery resumes or rolls back (§7).

### 6.3 Rebase and compaction (remount onto a newer lower)
Needed after commit or update, to make `physical_lower == logical_base` again and shrink `upper`.

1. Precondition: `write` lease, **no container uses the current generation volume** (otherwise postpone; `compaction_pending=true`, retried when the last consumer leaves).
2. `ensureCheckout(base_commit, seed?)` for the target lower.
3. **Normalize upper:** delete upper files whose sha256 equals the new lower's file (committed or no-op copy-ups) and whiteouts for paths absent in the new lower; remove now-empty directories; clear opaque flags that are no longer needed.
4. Create `mice-ws-<id>-g<gen+1>` pointing at the new lower, persist `{lower_commit, gen}` atomically, remove the old generation volume.
5. Verify `scan` equals the pre-rebase changes (safety net; on mismatch abort and keep the old generation).

I3 guarantees a commit never needs this synchronously; it is background maintenance plus an explicit step for **update-from-branch** (§7.2).

## 7. Operations (commit, update, reset)

### 7.1 Commit (atomic, supports deletions)
1. Needs the `write` lease (jobs/rw sessions already hold it; otherwise an implicit short lease, 423 if held). `scan` and stream-hash each file **while it is read for upload**; a path whose hash changed vs the scan (writer still active) is excluded and stays a change.
2. Changes = `scan` result (§5.1); specials ignored.
3. Create safe branch `mice/ws/<id>-<seq>` at `base_commit` (jobs: `mice/job/<id>`).
4. **Commit builder:** an *unnamed ephemeral Oxen workspace* on that branch (verify head == `base_commit`), stage added/modified (bytes read from `upper`), stage removals, **one** workspace commit (Oxen drops unnamed workspaces after commit). Result: one atomic commit including removals with Oxen's own conflict check. (`PUT /file/<branch>/<dir>` = one directory per commit and `DELETE /file` = one removal per commit are non-atomic; used only as the spike fallback.)
5. Merge the safe branch into the target. Conflict → outcome `conflict`: commit stays on the safe branch and is listed.
6. **Advance the logical base per committed path:** `base_commit := new commit`; `base.json` takes the committed hash for each committed path (from the stream). Per I3 nothing is remounted; those paths drop out of `changes` because `upper == base`. Queue a **seeded** `ensureCheckout(new commit)` + compaction (§6.3).
7. `op := idle`; audit `workspace.commit`. **Recovery:** safe-branch head ≠ `base_commit` and carries `op_id` in its message → finish step 6; no commit → roll back (delete safe branch, `op := idle`).

### 7.2 Update from branch (three-way, all-or-nothing)
Needs the `write` lease and **no container using the workspace** (it ends with a remount; the UI explains and offers *Stop sessions & update*).
1. Target head `T`; `ensureCheckout(T)`.
2. Upstream delta = `diff(base manifest, T manifest)` (skips identical subtrees via `dir_hash`).
3. Local changes = `scan`. A path is a **conflict** if it changed on both sides (modified/modified, modified/deleted, deleted/modified; an `opaque`-replaced directory conflicts with any upstream change under it).
4. Conflicts without `resolve: {path: "ours"|"theirs"}` ⇒ 409 `{conflicts:[…]}`, nothing changed.
5. Apply: `theirs` ⇒ drop the local upper entry; `ours` stays in upper; untouched paths are taken from the new lower automatically (overlay shows the new lower where upper has no entry). Normalize upper (§6.3 step 3) so stale copy-ups of unchanged files don't shadow upstream.
6. Flip `lower_commit = base_commit = T` (new generation volume), rewrite `base.json`, `op := idle`.
Recovery: crash before the flip → old generation is still consistent (only upper entries were dropped for `theirs`; replayable); crash after → idempotent finalize.

### 7.3 Reset
Needs the `write` lease and no container using it. Clear `upper` (and `work`), recreate generation volume at the logical base (rebase to `base_commit`). Idempotent. A running job's partial output is only cleared by an explicit Reset/Delete (D5).

## 8. Consumers

- **Sessions:** mount = lease + volume mount (`ro`/`rw`) at `/data/<ns>/<repo>`. No copy, baseline, `sync` or `mount-diff` (those code paths are removed in W4). Live view of a job = `ro` session on the job's workspace.
- **Cluster jobs:** workspace = selected or auto `job-<id>` (created and `ready` first); `write` lease (or `read` for `workspace_mode: ro`); container started with the volume mounted at `workdir` (default `/data`), `--user WORKSPACES_UID:GID`, umask `0002`; no per-job clone. Exit 0 → §7.1 commit; failure/cancel → upper left as is, nothing committed, diff visible. Auto workspace deleted only when auto **and** succeeded **and** merged (or empty diff); otherwise kept until the user deletes it. See [Jobs.md §13](./Jobs.md).
- **Local (laptop) jobs:** cannot mount server volumes. `mice job run --workspace <id>`: take the `write` lease (renewed) → download `…/archive` (helper `wsctl tar`, kernel view) → run Docker locally → upload changes as a tar + removal list → server applies through `wsctl` **under the lease** (kernel-correct whiteouts) → §7.1 commit → release. Not live-viewable (tree untouched until apply). Without `--workspace` nothing changes.
- **CLI:** `mice workspace create|list|show|delete|changes|commit|update|reset|ls|get|put|rm|mv|leases|unlock|retry` and `mice checkout list|warm|rm|gc` (admin).
- **Web:** Workspaces list/detail rebuilt (creation progress bar, Changes, Files, Jobs, Sessions, Leases, writer/waiting pills, Open live view, commit/update/reset dialogs, mount-mode picker). The old Oxen-workspace screens are relabeled **Staging** (§10, [Staging.md](./Staging.md)).

## 9. API (auth BFF; session or PAT)

| Route | Authz | Behavior |
| --- | --- | --- |
| `POST /auth/workspaces` | repo write | `{namespace, repo, name?, source: {branch}|{commit}}` → 202 `status: preparing` |
| `GET /auth/workspaces?namespace&repo` | repo read | List + change counts (from cache) + leases + status |
| `GET /auth/workspaces/:id` | repo read | Detail incl. `status`, build `progress`, `op`, `behind` (target head ≠ base), `upper_bytes`, `compaction_pending`, `driver` |
| `DELETE /auth/workspaces/:id` | repo write | 423 while any lease exists; removes volume, `upper`, `work` |
| `POST …/retry` | repo write | Retry failed preparation |
| `GET …/changes` | repo read | §5.1 |
| `POST …/commit` | repo write | `{branch?, message, paths?}` → `{commit, merge}` / conflict |
| `POST …/update`, `POST …/reset` | repo write | §7.2, §7.3 (409 `in_use` while containers use it) |
| `GET …/files/*` (dir list or content), `GET …/archive` | repo read | §5.2/§5.3 |
| `PUT/DELETE …/files/*`, `POST …/move`, `POST …/apply` (tar) | repo write + write lease | §5.4 |
| `POST/GET/DELETE …/leases`, `POST …/leases/:id/renew` | `read`: repo read; `write`: repo write; force: admin | Lease lifecycle |
| `GET/POST/DELETE /auth/checkouts…`, `POST /auth/store/gc`, `GET /auth/workspaces/capabilities` | repo read / admin | §3.6–3.7, §11 |

Quotas: `WORKSPACES_MAX_BYTES` per workspace (counts **upper** bytes only), `WORKSPACES_MAX_FILES`, `WORKSPACES_MAX_TOTAL_BYTES`, `WORKSPACES_MAX_FILE_BYTES` for uploads. Checked at lease grant and every 30 s while a writer runs (scan cache); over quota → no new writer leases, banner, running job is never killed.

AuthZ: add `/auth/workspaces/**` and `/auth/checkouts/**` to `authzPathMap` (GET → read, mutations → write, force-release/GC/delete-checkout → admin) under custom-role resource `workspaces`; `rw` mount needs repo write, `ro` needs read; re-checked at lease grant and at connect.
Audit: `workspace.create/delete/commit/update/reset/compact`, `workspace.lease.acquire/release/force_release`, `checkout.build/evict/corrupt`, `store.gc/full`. Names, never file contents.

## 10. Renaming Oxen workspaces to Staging (naming only, now)

To free the word *workspace*, W0 relabels the existing Oxen-workspace UI/CLI as **Staging** (UI strings, nav, route `/staging`, CLI group `mice staging` with `mice workspace` kept as a deprecated alias for one release **only until W5 replaces it**). Behaviour is unchanged; functional redesign is a later, independent project: [Staging.md](./Staging.md). The favorites id grammar `ns/repo!workspaceId` is kept for staging areas; new Mice workspaces use `ns/repo~workspaceId`.

## 11. Capability probe and configuration

`GET /auth/workspaces/capabilities` (also logged at startup) reports: kernel version; Docker reachable; store/workspace volumes found + filesystem types + `d_type`; **overlay mount test** (create a throwaway overlay volume with two files, mount it in a `--rm` container, write, check copy-up and `getfattr` markers, remove); hardlink test (`link` across `blobs`↔`commits`); reflink test; `getfattr` present; chosen `driver`. Failing a required check ⇒ falls back per `WORKSPACES_DRIVER=auto` with a reason shown in the admin UI.

| Env | Default |
| --- | --- |
| `WORKSPACES_DRIVER` | `auto` |
| `WORKSPACES_UID`/`GID` | BFF uid/gid |
| `WORKSPACES_STORE_VOLUME` / `WORKSPACES_VOLUME` | `mice-store` / `mice-workspaces` |
| `WORKSPACES_HOST_STORE_DIR` / `WORKSPACES_HOST_WS_DIR` | auto from `docker volume inspect` |
| `CHECKOUT_DOWNLOAD_CONCURRENCY` / `CHECKOUT_LIST_CONCURRENCY` | 8 / 8 |
| `CHECKOUT_KEEP_PER_REPO` / `CHECKOUT_TTL_DAYS` | 3 / 14 |
| `CHECKOUT_PREWARM_INTERVAL_SEC` / `WORKSPACES_PREWARM_BRANCHES` | 60 / default branch |
| `WORKSPACES_STORE_MAX_BYTES` / `WORKSPACES_MAX_BYTES` / `WORKSPACES_MAX_FILES` | unset / 50 GiB / 1 000 000 |
| `WORKSPACES_PREPARE_TIMEOUT_SEC` / `JOBS_WAIT_TIMEOUT_SEC` / `JOBS_LOCK_GRACE_SEC` | 3600 / 3600 / 300 |

`compose.yaml`: add named volumes `mice-store`, `mice-workspaces` mounted into `auth`; keep the docker socket; no extra capabilities.

## 12. Phases (each shippable with tests)

- [x] **W0** Spike (done; findings in [Workspaces.spikes.md](./Workspaces.spikes.md). Overlay works on Docker Desktop; `getfattr` is not in the auth image yet) + foundations: capability probe; **verify** Docker-volume overlay (Linux and Docker Desktop), `userxattr`, shared mount between rw and ro containers, `getfattr` markers; Oxen listing facts (dir hashes, recursion, file hash algorithm, revision→commit id); UI/CLI relabel Oxen workspaces → **Staging**
- [x] **W1** Checkout store (done, minus the admin CLI; routes under `/auth/checkouts`, `/auth/store`; `.oxen` entries are skipped, not rejected): `ensureCheckout` (incremental, dir-prune, resume, publish), manifests, GC, scrub, progress, prewarm, admin routes/CLI
- [~] **W2** Workspace store + overlay driver (partial: async create/retry/list/get/delete, `scan`, changes, effective manifest, file reads, archive, quotas, copy/reflink prepare are done; NOT done: mount spec, `wsctl` mutations, reset): create (async), mount spec, `scan`, effective manifest, file API reads, `wsctl` mutations, reset, delete, quotas, `copy`/`reflink` fallbacks
- [x] **W3** Leases, one-writer enforcement, ro/rw mounts, reconciliation, audit, authz map (backend done; see `Workspaces.spikes.md` §W3. Deviations: extra route `POST /auth/workspaces/:id/leases/:leaseId/mount` returns the MountSpec; over-quota write lease → 507, not-ready/op≠idle → 409; opaque-dir detection uses a static Go helper `mice-xattr` (auth/cmd/mice-xattr, Makefile target not updated) instead of `attr`; waiting-writer queue is only a flag (`setWriterWaiting`), queue is W5; `requireWriteLease` is exported but no file-mutation routes exist yet; `GET …/changes` always rescans. Real-Docker check: `node auth/scripts/ws-integration.mjs`)
- [ ] **W4** (decisions: on `conflict` the target branch and the workspace `upper` stay untouched and the commit remains on the safe branch; audit records Principal, workspace id, base/result commits and merge outcome, failing closed under `GXP_STRICT`) Commit builder (Oxen ephemeral workspace; **spike first**), merge, op state machine + recovery, seeded rebase/compaction, update-from-branch
- [~] **W5** Jobs on workspaces (Docker runner), auto workspace, wait/timeout, live-view session; Sessions mount rewrite (drop copy/sync/mount-diff) (**Sessions half done**: `workspace_id` session mounts, see `Sessions.md` §11a and `Workspaces.spikes.md` §W5-sessions. Deviations: leases are taken at session create (so the create response already carries `effective_mode`/`notices`), renewed every 60 s, released after the container is removed on stop/destroy/failure/sweeper; rw that cannot get the write lease (423 or over quota) degrades to ro with a `notices[]` entry; PUID/PGID/UMASK env instead of `--user` (rdesktop init); `POST /auth/sessions/:id/remount` recreates the container (guest state outside mounts is lost); workspace JSON `session_count` = distinct session lease holders; pin mounts unchanged. Real-Docker check: `node auth/scripts/ws-sessions-integration.mjs`. **Follow-up done**: sessions mount workspaces only (commit pins/clone path removed from Sessions; legacy records load, retry drops pin mounts with a notice), `mountable_modes` on workspace JSON, delete guard also via the sessions store, on-demand `new_workspace` mounts (leased at provision time), `GET /auth/sessions?namespace=&repo=`. Still open: jobs on workspaces, auto workspace, wait/timeout, live-view via jobs, dropping legacy copy/sync code)
- [ ] **W6** CLI `mice workspace`/`mice job run --cluster`/local-job archive-apply; web UI rebuild; e2e; docs
- [ ] **W7** (separate design) Kubernetes overlay support (node agent or in-pod fuse-overlayfs)

Phases W0 and W1 deliver value on their own (fast workspace-independent checkouts, also usable by `commit_clone` jobs today).

## 13. Test plan

| Case | Expectation |
| --- | --- |
| TC-WS-01 | First checkout of a repo (≥ 5 000 files) matches the commit: file count/bytes/hashes equal; `READY` last; no `.oxen` |
| TC-WS-02 | Second workspace on the same commit: no Oxen file downloads, completes in seconds, adds ~0 bytes to the store |
| TC-WS-03 | New commit touching 3 files: checkout downloads exactly those files (dir-prune + known-blob index); other files are hardlinks (`st_nlink > 1`) |
| TC-WS-04 | Kill the BFF mid-build, restart: stale tmp adopted/swept, retry only downloads missing blobs; no half-published checkout is ever visible |
| TC-WS-05 | 10 concurrent creates for one commit → one build (single flight) and identical results; progress visible |
| TC-WS-06 | Oxen down mid-sync → workspace `preparing` with `last_error`, auto-retry succeeds when restored; disk full → 507 and cleanup |
| TC-WS-07 | Hostile listing names (`..`, `/`, NUL, `.oxen`, backslash) rejected; symlink entries skipped and counted |
| TC-WS-08 | GC: unreferenced old checkouts evicted, referenced kept; blobs with nlink 1 removed; concurrent build never loses a blob; scrub quarantines a corrupted blob and marks checkouts `corrupt` |
| TC-WS-09 | Overlay mount: guest sees all files; writing a lower file copy-ups into upper only; checkout files unchanged (I4) |
| TC-WS-10 | `changes`: add, modify, same-content rewrite (not a change), delete (whiteout), `rmdir`+`mkdir` (opaque) → removed paths correct; weird filenames (space, newline, quote, unicode) |
| TC-WS-11 | `scan` cost is independent of tree size (10 changes in a 100 k-file tree) |
| TC-WS-12 | **Live view:** `ro` session on a running job's workspace sees new/updated files within seconds; every write attempt from the guest (create, rename, delete, chmod) fails read-only; job result unaffected |
| TC-WS-13 | Single writer: second job queues with `wait_reason`; writes/commit/delete/second writer → 423 with holder; ro session, GET, archive OK; no-wait → 409; no new rw mounts while a job waits |
| TC-WS-14 | Lease released on terminal/cancel/timeout/restart; admin force-release audited; busy `rw` session starts `ro` with banner |
| TC-WS-15 | Commit: single Oxen commit incl. a deletion on a safe branch, merged to target; changes empty afterwards although the overlay is not remounted (I3); compaction later shrinks upper with no visible change |
| TC-WS-16 | File edited mid-commit stays a change; base hash = committed hash |
| TC-WS-17 | Target moved: non-overlapping → merge OK; overlapping → `conflict`, safe-branch commit kept |
| TC-WS-18 | Update from branch: clean merge shows upstream files; conflicts → 409 with no change; `resolve ours/theirs`; refused with 409 `in_use` while a container uses it |
| TC-WS-19 | Crash at each commit/update/compaction step → recovery completes or rolls back; I1–I3 hold |
| TC-WS-20 | Tamper check: upper changed between lease and start → job fails |
| TC-WS-21 | Planted symlink in upper pointing to a BFF file: scan/file API/archive/commit never read it; path traversal rejected |
| TC-WS-22 | Container-created files deletable by BFF and by `wsctl` (uid/gid) |
| TC-WS-23 | Cluster job without workspace → `job-<id>`; deleted after merged success; kept (partial output visible as changes) after failure until the user deletes it |
| TC-WS-24 | Multi-mount session all-or-nothing; partial failure releases leases |
| TC-WS-25 | Local job with `--workspace`: archive down, apply up (incl. deletions), commit, lease released |
| TC-WS-26 | AuthZ: read-only user cannot write/commit/take the write lease; unauthenticated 401; custom role honoured; admin-only checkout/store ops |
| TC-WS-27 | Capability probe reports correct driver; `copy`/`reflink` fallback produces identical `changes` semantics |
| TC-WS-28 | UI: create with progress bar, browse, upload, changes, commit, conflict, writer pill + Open live view during a job; Staging relabel present |

## 14. Residual risks

| Risk | Mitigation |
| --- | --- |
| Docker-volume overlay or `userxattr` not available on a target host | Capability probe + W0 spike; `reflink`/`copy` fallbacks; clear admin message |
| Overlay semantics subtleties (opaque dirs, rename of directories, `redirect_dir`) | Mount with `redirect_dir=off,index=off,metacopy=off`; kernel produces all upper entries; dedicated tests TC-WS-10 |
| Reading `upper` while mounted | Read-only reads of an upper dir are safe; only *writes* to layers are undefined — the BFF never writes to `upper`/lower directly (helper mutates through the mount) |
| Hardlink farm: one inode shared by many checkouts | Lower is read-only by construction; copy-up creates a new inode; blobs only written by the store code; scrub detects corruption |
| EMLINK, inode exhaustion, huge directories | Copy fallback for EMLINK; inode watermark in store GC; per-dir listing paged |
| Partial files visible to readers | UI *in progress* marker; atomic temp+rename in jobs |
| Helper (`wsctl`) latency per mutation | Batched ops; reads need no helper |
| Single-writer is admission control; host-level writers | Advisory; tamper check; ro enforced at mount |
| Oxen behaviour unverified (listing dir hashes, ephemeral-workspace commit, merge, file hash algorithm) | W0/W4 spikes first; fallbacks: no dir-prune (hash-only compare), per-directory `PUT /file` commits (non-atomic, documented) |
| Store growth | LRU + watermarks + keep-N + TTL; blobs deduplicated by content across commits and repos |
| Kubernetes | Out of scope for this iteration (W7); copy/reflink on RWX PVC meanwhile |
| macOS Docker Desktop VM disk limits | Probe reports VM disk free; documented |

> **Update:** Oxen workspaces are now called **Stages** (UI `/stages`, CLI `mice stage`, favorites type `stage`). Sessions and jobs can no longer mount a stage; only commit-pinned read-only snapshots are mounted. Mountable Mice workspaces (this doc) remain the future mount target.
