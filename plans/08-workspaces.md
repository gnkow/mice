# WORKSPACES — overlay working trees over a shared per-commit checkout store (rev 3)

> This file merges the former `Workspaces.md` (rev 3, the body, §1–§15), `Workspaces.rev2.md` (history only, §18), `Workspaces.spikes.md` (§16) and `Staging.md` (§17). It is the single plan for the Workspaces topic.

A **Mice workspace** is a persistent, writable filesystem view of a repo at a branch/commit that Sessions and Jobs **mount**. It is built from two parts:

- a **shared, immutable per-commit checkout** (the *lower layer*), downloaded once and reused by every workspace of that repo; and
- a small **per-workspace changes directory** (the *upper layer*), holding only what was added, modified or deleted.

Creating a workspace copies nothing. Disk grows only with changes. The full tree (all files, always) is available to every consumer.

> Rev 3 supersedes rev 2 (kept only as history in [§18](#18-appendix-c--superseded-rev-2-decisions)): scratch/clone-per-workspace is replaced by overlay + checkout store. Oxen's own server-side workspaces are **not** used; they move to a separate, later feature — see [§17](#17-appendix-b--stages--server-side-oxen-workspaces-separate-unscheduled-feature). Spike results: [§16](#16-appendix-a--spike-findings). Jobs: [09-jobs.md §13](./09-jobs.md). Sessions: [10-sessions.md §11](./10-sessions.md).

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
1a. **Whiteout forms (spike finding):** on the verified kernel (6.12, ext4) a whiteout is a **character device 0/0** in `upper`, not a `user.overlay.whiteout` xattr; `scanUpper` must accept both forms. Opaque directories carry `user.overlay.opaque=y`; the upper root also carries `user.overlay.uuid`/`impure`, which are ignored.
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
- **Fencing (requirement, unchecked):** lock files/heartbeats alone cannot stop a stale or partitioned writer (paused BFF, second BFF instance, zombie container) from writing after its lease expired. Each `write` lease carries a monotonically increasing **fencing token** persisted in `state.json`; mutations (`wsctl`, commit, update, reset, compaction) present the token and are rejected if it is not the current one; a new grant fences the previous holder by removing its container first. See §15 Q1.

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
4a. **Durable conflict detail (requirement, unchecked):** the 409 body and the audit event (`workspace.update`) record, per conflicting path: conflict type, base/local/upstream hashes, the `resolve` choice (`ours`/`theirs`), and who chose it, plus the target head `T`, base commit and `op_id`. Persist it in `state.json`/the op journal before applying so recovery and audit can reconstruct what was overwritten (a `theirs` choice discards local upper content). Fail closed under `GXP_STRICT`. See §15 Q3.
5. Apply: `theirs` ⇒ drop the local upper entry; `ours` stays in upper; untouched paths are taken from the new lower automatically (overlay shows the new lower where upper has no entry). Normalize upper (§6.3 step 3) so stale copy-ups of unchanged files don't shadow upstream.
6. Flip `lower_commit = base_commit = T` (new generation volume), rewrite `base.json`, `op := idle`.
Recovery: crash before the flip → old generation is still consistent (only upper entries were dropped for `theirs`; replayable); crash after → idempotent finalize.

### 7.3 Reset
Needs the `write` lease and no container using it. Clear `upper` (and `work`), recreate generation volume at the logical base (rebase to `base_commit`). Idempotent. A running job's partial output is only cleared by an explicit Reset/Delete (D5).

## 8. Consumers

- **Sessions:** mount = lease + volume mount (`ro`/`rw`) at `/data/<ns>/<repo>`. No copy, baseline, `sync` or `mount-diff` (those code paths are removed in W4). Live view of a job = `ro` session on the job's workspace.
- **Cluster jobs:** workspace = selected or auto `job-<id>` (created and `ready` first); `write` lease (or `read` for `workspace_mode: ro`); container started with the volume mounted at `workdir` (default `/data`), `--user WORKSPACES_UID:GID`, umask `0002`; no per-job clone. Exit 0 → §7.1 commit; failure/cancel → upper left as is, nothing committed, diff visible. Auto workspace deleted only when auto **and** succeeded **and** merged (or empty diff); otherwise kept until the user deletes it. See [09-jobs.md §13](./09-jobs.md).
- **Local (laptop) jobs:** cannot mount server volumes. `mice job run --workspace <id>`: take the `write` lease (renewed) → download `…/archive` (helper `wsctl tar`, kernel view) → run Docker locally → upload changes as a tar + removal list → server applies through `wsctl` **under the lease** (kernel-correct whiteouts) → §7.1 commit → release. Not live-viewable (tree untouched until apply). Without `--workspace` nothing changes.
- **CLI:** `mice workspace create|list|show|delete|changes|commit|update|reset|ls|get|put|rm|mv|leases|unlock|retry` and `mice checkout list|warm|rm|gc` (admin).
- **Web:** Workspaces list/detail rebuilt (creation progress bar, Changes, Files, Jobs, Sessions, Leases, writer/waiting pills, Open live view, commit/update/reset dialogs, mount-mode picker). The old Oxen-workspace screens are relabeled **Staging**, finally **Stages** (§10, [§17](#17-appendix-b--stages--server-side-oxen-workspaces-separate-unscheduled-feature)).

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

> **Update:** the name finally chosen is **Stages** (UI `/stages`, CLI `mice stage`, favorites type `stage`; see [§17](#17-appendix-b--stages--server-side-oxen-workspaces-separate-unscheduled-feature)), so read "Staging" below as "Stages". Route ownership: `/auth/workspaces/**` and `/auth/checkouts/**` are Mice workspaces; Oxen's proxied `/api/repos/:ns/:repo/workspaces/**` is owned by Stages and is **not** deprecated by this plan. Only the `mice workspace` alias for Oxen workspaces is retired.

To free the word *workspace*, W0 relabels the existing Oxen-workspace UI/CLI as **Staging** (UI strings, nav, route `/staging`, CLI group `mice staging` with `mice workspace` kept as a deprecated alias for one release **only until W5 replaces it**). Behaviour is unchanged; functional redesign is a later, independent project: [§17](#17-appendix-b--stages--server-side-oxen-workspaces-separate-unscheduled-feature). The favorites id grammar `ns/repo!workspaceId` is kept for staging areas; new Mice workspaces use `ns/repo~workspaceId`.

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

- [x] **W0** Spike (done; findings in [§16](#16-appendix-a--spike-findings). Overlay works on Docker Desktop; `getfattr` is not in the auth image yet) + foundations: capability probe; **verify** Docker-volume overlay (Linux and Docker Desktop), `userxattr`, shared mount between rw and ro containers, `getfattr` markers; Oxen listing facts (dir hashes, recursion, file hash algorithm, revision→commit id); UI/CLI relabel Oxen workspaces → **Staging**
- [x] **W1** Checkout store (done, minus the admin CLI; routes under `/auth/checkouts`, `/auth/store`; `.oxen` entries are skipped, not rejected): `ensureCheckout` (incremental, dir-prune, resume, publish), manifests, GC, scrub, progress, prewarm, admin routes/CLI
- [~] **W2** Workspace store + overlay driver (partial: async create/retry/list/get/delete, `scan`, changes, effective manifest, file reads, archive, quotas, copy/reflink prepare are done; NOT done: mount spec, `wsctl` mutations, reset): create (async), mount spec, `scan`, effective manifest, file API reads, `wsctl` mutations, reset, delete, quotas, `copy`/`reflink` fallbacks
- [x] **W3** Leases, one-writer enforcement, ro/rw mounts, reconciliation, audit, authz map (backend done; see §16.3. Deviations: extra route `POST /auth/workspaces/:id/leases/:leaseId/mount` returns the MountSpec; over-quota write lease → 507, not-ready/op≠idle → 409; opaque-dir detection uses a static Go helper `mice-xattr` (auth/cmd/mice-xattr, Makefile target not updated) instead of `attr`; waiting-writer queue is only a flag (`setWriterWaiting`), queue is W5; `requireWriteLease` is exported but no file-mutation routes exist yet; `GET …/changes` always rescans (finding: the 3 s scan cache made `changes` stale right after container writes). Acceptance: TC-WS-13, 14, 20, 22, 29–31; real-Docker check: `node auth/scripts/ws-integration.mjs`)
- [ ] **W4** (decisions: on `conflict` the target branch and the workspace `upper` stay untouched and the commit remains on the safe branch; audit records Principal, workspace id, base/result commits and merge outcome, failing closed under `GXP_STRICT`) Commit builder (Oxen ephemeral workspace; **spike first**), merge, op state machine + recovery, seeded rebase/compaction, update-from-branch
- [~] **W5** Jobs on workspaces (Docker runner), auto workspace, wait/timeout, live-view session; Sessions mount rewrite (drop copy/sync/mount-diff) (**Sessions half done**: `workspace_id` session mounts, see `10-sessions.md` §11a and §16.4. Deviations: leases are taken at session create (so the create response already carries `effective_mode`/`notices`), renewed every 60 s, released after the container is removed on stop/destroy/failure/sweeper; rw that cannot get the write lease (423 or over quota) degrades to ro with a `notices[]` entry; PUID/PGID/UMASK env instead of `--user` (rdesktop init); `POST /auth/sessions/:id/remount` recreates the container (guest state outside mounts is lost); workspace JSON `session_count` = distinct session lease holders; pin mounts unchanged. Acceptance: TC-WS-24, 32, 33; real-Docker check: `node auth/scripts/ws-sessions-integration.mjs`. **Follow-up done**: sessions mount workspaces only (commit pins/clone path removed from Sessions; legacy records load, retry drops pin mounts with a notice), `mountable_modes` on workspace JSON, delete guard also via the sessions store, on-demand `new_workspace` mounts (leased at provision time), `GET /auth/sessions?namespace=&repo=`. Still open: jobs on workspaces, auto workspace, wait/timeout, live-view via jobs, dropping legacy copy/sync code)
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
| TC-WS-29 | Whiteout detection accepts both char-device 0/0 and `user.overlay.whiteout` xattr; upper-root `uuid`/`impure` markers are ignored (W3 spike) |
| TC-WS-30 | Opaque directories are detected without `getfattr` (static `mice-xattr` fallback); no degraded-opaque warning in `changes` (W3 spike) |
| TC-WS-31 | `GET …/changes` right after a container write is never stale (forced rescan, not the 3 s cache) |
| TC-WS-32 | Stop/destroy of a session removes its container **before** releasing leases, so `docker volume rm` and workspace delete succeed; delete while leased/mounted → 423 naming holders and sessions (W5 spike) |
| TC-WS-33 | `rw` session on a busy workspace degrades to `ro` with a `notices[]` entry naming the holder; `POST /sessions/:id/remount` upgrades it after the writer ends and `upper` persists (W5 spike) |
| TC-WS-34 | Stale writer fencing: a holder with an expired/superseded fencing token is rejected by `wsctl`/commit/update/reset (requirement, §15) |
| TC-WS-35 | Backup/restore drill: restore `workspaces/` + `store/index` + journals onto a fresh volume; reconciliation finds no orphan or missing generation; `changes` equals the pre-backup result (requirement, §15) |

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

## 15. Open requirements and questions (all unchecked; not approved)

Notifications cross-reference [14-notifications.md](./14-notifications.md); audit as in §9.

- [ ] **Fencing/lease authority** beyond lock files: fencing token per `write` lease, checked by every mutation (§6.1; TC-WS-34)
- [ ] **Workspace notification events** (catalog entries for 14-notifications.md, recipients = workspace creator/holder + repo admins): lease contention (writer waiting longer than a threshold, force-release), quota exhaustion (workspace `WORKSPACES_MAX_BYTES`, store watermark/`store.full`), failed commit/merge (incl. `conflict` outcome), failed update/preparation, stuck operations (`op != idle` beyond a timeout, `compaction_pending` stalled, reconciliation recovery taken)
- [ ] **Durable conflict-resolution detail** for audit on three-way update (§7.2 step 4a)
- [ ] **Backup/restore and disaster recovery** for workspace trees: define what is backed up (`workspaces/<id>/{upper,state.json,base.json}`, manifests, `store/index` journals, op/lease journals), what is rebuildable (`store/commits` via `ensureCheckout`, blobs), consistency (quiesce or snapshot with no writer lease; `work/` excluded), overlay generation volumes recreated from state on restore, RPO/RTO targets, and a restore drill (TC-WS-35)

| # | Question | Notes |
| --- | --- | --- |
| Q1 | Is the fencing token enforced in `wsctl` only, or also by a store-level generation check, and how does it work with a second BFF instance? | Open. Single BFF assumed today |
| Q2 | Which notification events are mandatory vs. opt-in, and are lease-contention events rate-limited? | Open; align with 14-notifications.md catalog |
| Q3 | Is conflict detail kept in audit only, or also retained in the workspace for later review? | Open |
| Q4 | RPO/RTO for workspace data, and is the `upper` of a failed job's partial output (D5) in backup scope? | Open |
| Q5 | Snapshot mechanism for `upper` while a rw container runs (filesystem snapshot vs. quiesce)? | Open |

## 16. Appendix A — Spike findings

Former `Workspaces.spikes.md`. Run on 2026-10 against Docker Desktop (macOS, arm64): Docker 29.5.3, linuxkit kernel 6.12.76, Oxen server 0.61.1. Phases: §12.

### 16.1 W0 spike: Docker-volume overlay WORKS on Docker Desktop

- A named volume created with `--opt type=overlay --opt device=overlay --opt o=lowerdir=…,upperdir=…,workdir=…,userxattr` mounts correctly. Paths are the VM-side `docker volume inspect` Mountpoints (`/var/lib/docker/volumes/<vol>/_data/...`), because the Docker daemon (not the BFF container) resolves them.
- Kernel mounted it as `redirect_dir=nofollow,uuid=on,userxattr`. Backing fs is ext4.
- Copy-up works (file appears in upper with `user.overlay.origin`); lower is untouched. New files land in upper.
- Whiteout = **character device 0/0** in upper (not an xattr) on this kernel. `scanUpper` handles both that and the `user.overlay.whiteout` xattr form.
- `rm -r d; mkdir d` makes `d` opaque: xattr `user.overlay.opaque=y`. Upper root also carries `user.overlay.uuid` / `impure`.
- A second container mounting the same volume `readonly` is enforced ("Read-only file system") and sees live writes from the rw container.
- `docker volume rm` fails while a container uses the volume and works afterwards.
- Reflink: `ENOTSUP` on the volumes (ext4) → driver falls to overlay, then `copy`.

**getfattr**

- Not present in the auth image (node:22-alpine, busybox has `setfattr` only). `apk add attr` fails on this corporate-TLS network, so the Dockerfile was NOT changed. Node has no xattr API.
- Consequence (before W3): opaque directories could not be detected → scan treated them as merged and emitted a warning (`/auth/workspaces/:id/changes` `warnings`); the capability probe reports `getfattr.ok=false`. Resolved in W3 by `mice-xattr` (§16.3). Alternative if needed: add `attr` to the image (or a probe container); Python `os.listxattr` works in `python:3.13-slim`.

**Oxen listing facts**

- `GET /api/repos/:ns/:repo/dir/<rev>/<path>?page=&page_size=` is **non-recursive**; `recursive=true` is ignored. `page_size` up to 5000 honored; fields `page_number`, `total_pages`, `total_entries`.
- `dir.hash` = directory hash, `dir.size` = recursive bytes. Entries: `filename`, `hash`, `is_dir`, `size`, `data_type`.
- Directory hashes are **stable across commits** when the subtree is unchanged → dir-hash prune is valid.
- File hashes are xxh3-128 of content, hex **not zero-padded** (e.g. 31 chars); equal for equal content at different paths. Compare as opaque strings only (not sha256/md5). The store computes its own sha256 while downloading.
- Revision → commit: `GET /api/repos/:ns/:repo/revisions/<branch-or-commit>` → `resource.commit.id`. `GET …/branches/main` → `commit_id`. `GET …/commits/<id>` works for ids only (`commits/main` is 404). `dir/<commitId>/…` works.
- `GET …/file/<rev>/<path>` returns raw bytes; `dir/<rev>/<file>` is 404 for files.
- `PUT …/file/<branch>/<fullpath>` takes the full path in the URL (multipart filename ignored; empty path = 400).

### 16.2 W1 implementation notes / deviations

- `.oxen` entries named exactly `.oxen` are skipped (counted in meta), not build-aborting; `..`, `/`, `\`, NUL, empty names abort with 422.
- Resume uses a per-repo durable journal `store/index/<ns>/<repo>.tsv` (oxen hash → sha256) plus existing manifests.
- GC safety relies on "link or re-download" instead of a GC lock.
- Archive is computed by the BFF from upper + checkout (no wsctl needed yet).

### 16.3 W3 findings (leases, mounts, real kernel)

- Per-generation volume `mice-ws-<id>-g<gen>` is created with `docker volume create --driver local -o type=overlay -o device=overlay -o o=lowerdir=…,upperdir=…,workdir=…,userxattr`; host paths come from `docker volume inspect` Mountpoint of `mice-store` / `mice-workspaces` (inside the Docker Desktop VM; verified working from the auth container, same as the W0 probe).
- Real-kernel results (`auth/scripts/ws-integration.mjs`, alpine container with rw mount): new file → `added`; modified lower file → `modified`; deleted lower file → whiteout → `removed`; `rm -r dir && mkdir dir` → opaque dir → lower children reported `removed`; no warnings. Lower checkout checksums unchanged (I4).
- A second container with the same volume `--mount …,readonly` sees the writer's changes; write, touch, mkdir and rm all fail.
- Read lease during a write lease works; second write lease → 423 with holder; workspace delete while leased → 423.
- After release and container exit `docker volume rm` succeeds; container-created upper files are deletable by the BFF (root in the auth container) → workspace dir removed (TC-WS-22).
- `getfattr` (package `attr`) is not available in the image, so `mice-xattr` (static Go, `unix.Llistxattr/Lgetxattr`, getfattr-compatible output) is copied in; the scan falls back to it, so the degraded-opaque warning is gone.
- Scan cache (3 s) made `changes` stale right after container writes; `changes` now forces a rescan.
- Containers run with `--user WORKSPACES_UID:GID` only when configured; MountSpec carries `user` and `umask: "0002"`.

### 16.4 W5-sessions findings (workspace mounts in desktop sessions)

- Real stack (`auth/scripts/ws-sessions-integration.mjs`, rdesktop image, Docker Desktop): session A rw → write lease; session B rw → degraded to ro with notice naming A; both reach `ready`; A writes through `/data/<ns>/<repo>` and `changes` reports added/modified/removed (whiteout) correctly; B sees the new file and cannot write; workspace delete → 423 naming both sessions; `session_count` 2; `?workspace_id=` filter works.
- Stop A removes its container and releases the write lease; `POST /sessions/B/remount` then upgrades B to rw and the upper persisted across the new container.
- A stopped Docker container still holds its volumes, so stop/destroy `rm` the container before releasing leases (otherwise `docker volume rm` on workspace delete would fail).
- rdesktop's init needs root, so ownership uses `PUID`/`PGID` env (from WORKSPACES_UID/GID, default 1000) plus `UMASK=002` instead of `--user`.
- Background provisioning has no group info for the owner, so authz is checked at create/retry/connect, not inside the provisioner.

### 16.5 Findings still to gather (all unchecked)

- [ ] **Production Kubernetes overlay validation:** on a real cluster (not Docker Desktop), verify whether a pod can mount overlay with `userxattr` via a node DaemonSet/CSI-style publish or in-pod fuse-overlayfs; kernel ≥ 5.11 and ext4/xfs `d_type` on node disks; behaviour on RWX PVC (NFS/CSI) with the `copy`/`reflink` fallback; copy-up/whiteout/opaque markers and read-only second mount; pod security (no privileged escalation); node drain/reschedule while a lease is held. Feeds W7 in §12
- [ ] **Backup and recovery:** snapshot/restore of `mice-workspaces` (`upper`, `state.json`, `base.json`) and `store/index` journals while a writer is active and while idle; whether overlay generation volumes can be recreated from state after restore; rebuild of `store/commits` from Oxen after losing `mice-store`; measured restore time vs. workspace size; what is lost for a failed job's partial output. Feeds the backup/DR requirement in §15

## 17. Appendix B — Stages — server-side Oxen workspaces (separate, unscheduled feature)

Former `Staging.md`. Status: **not scheduled.** This section only parks the feature that Mice previously called "workspaces" so the word is free for the overlay working trees above. Behaviour today is unchanged; only the label changes (§10).

### 17.1 What it is

An Oxen workspace is a server-side staging area: a base commit (branch head) plus staged changes in a RocksDB, with file bytes in the repo's version store. It supports staging uploads/removals over HTTP, listing staged changes, and committing to a branch (`merge`/`commit`). It has no mountable filesystem and no locking, and a commit conflicts only when the branch changed a path the workspace also staged.

### 17.2 Good uses (why keep it)

- Browser/CLI "edit and commit" without a local clone (upload → review staged → commit).
- Review area for batch uploads before they become a commit.
- Used transiently as the **atomic commit builder** inside Mice workspaces (§7.1) — that internal use is not a user-facing stage.

### 17.3 Scope when scheduled (outline)

- Naming in UI/CLI/docs follows §17.4 (`/stages`, `mice stage …`, favorites type `stage`; existing ids `ns/repo!<id>` stay valid).
- Keep current screens (list, detail, staged changes, file upload, commit) and e2e coverage; fix gaps then: base-advance/behind indicators, multi-file delete, conflict messaging, authz path map entries for `…/workspaces/**` under a custom-role resource `staging`.
- Out of scope: mounting, locking, jobs, sessions.

### 17.4 Naming

**Decided: Stages** (a single Oxen workspace is a *stage*; UI nav and route `/stages`, CLI `mice stage`, favorites type `stage`). This is what the web, CLI and favorites code already use (`web/src/App.tsx` routes `stages` / `stages/:workspaceId`; `auth/src/favoritesStore.ts` `FAVORITE_TYPES` includes `stage` and maps legacy `workspace` rows to it; `mice favorite list --type …|stage|…`). It supersedes the earlier **Staging** decision (`/staging`, `mice staging`, favorites kind `staging`, authz resource `staging`), which was never shipped; §10 still says Staging in places and should read Stages (its update note says so). "Staging" survives only as the generic term for the server-side staging area. Earlier candidates (Vaults, Drafts, Shelves, Stashes, Changesets, Inboxes) were rejected.

### 17.5 Existing routes remain reachable

The Oxen workspace routes stay available and unchanged for now: the BFF/oxen-server `…/workspaces/**` API (authz actions `workspace.read` / `workspace.write` / `workspace.create` …) and clients that still use it. The rename is label-only; Mice workspaces (overlay working trees) are a separate feature and never reuse these routes (route ownership: §9, §18).

### 17.6 Deprecation / migration (proposed, not scheduled)

- [ ] Decide whether the `workspace.*` authz actions and the `…/workspaces/**` path map get a `stage` resource name, with aliases and a migration of custom roles
- [ ] Retire the `mice workspace …` alias and any `/workspaces` UI redirects once Mice workspaces ship (W5, §12), with a one-release deprecation notice
- [ ] Keep legacy favorites rows (`workspace` type, `ns/repo!<id>`) readable through the migration

Open questions:

1. Does the authz resource keep the `workspace` action names indefinitely, or move to `stage` with a compatibility window?
2. Should the old `/workspaces` UI path redirect to `/stages` once Mice workspaces claim it?

## 18. Appendix C — Superseded rev 2 decisions

Former `Workspaces.rev2.md` ("BFF-owned remote working trees", rev 2). **Superseded; do not implement from it.** Nothing from rev 2 is tracked or approved; where it differs from §1–§15, rev 3 wins. Rev 2's phases **W0–W6** have different contents from §12's **W0–W7**; do not map numbers between them. Only rev-2 facts that remain useful history are kept here.

**Route ownership (still valid):** `/auth/workspaces/**` and `/auth/checkouts/**` belong to Mice workspaces (§9). Oxen's own `/api/repos/:ns/:repo/workspaces/**` is proxied by the BFF and owned by **Stages** (§17); it is not deprecated or removed by this plan, and Mice workspaces never use it except transiently as the commit builder (§7.1). Rev 2's "ignored/unused" wording is void.

### 18.1 Useful history

- Rev 2 core invariant: `tree == base_commit snapshot + changes` (live diff), preserved by every operation per path. Rev 3 restates it as I1–I4 (§1) over `upper` + logical base.
- Rev 2 state fields: `id`, `kind: user|auto`, `name`, `namespace`, `repo`, `branch`, `base_commit`, `created_by/at`, `updated_at`, `op` (`idle|committing|updating|resetting`, with `op_id`), `quota_bytes`; per-workspace `manifest.json` (`path → {size, mtime_ns, sha256}`) and `base.json` (`path → {sha256, oxen_hash}`). Names unique per repo; `job-<id>`/`session-<id>` reserved for `kind:auto`.
- Confirmed by the user in rev 2 and carried into rev 3 (D3–D5): the job writes directly into the workspace, the workspace is frozen while a job runs, partial output of a failed job stays, sessions get a read-only live view.
- Untrusted-tree rules: scan with `lstat`, never follow symlinks; symlinks/devices/FIFOs/sockets are *special* (shown, never read or committed); file-API paths resolved and kept under the tree realpath; scans skip other devices; no `.oxen` dir in the tree; quotas `WORKSPACES_MAX_BYTES`, `WORKSPACES_MAX_TOTAL_BYTES`, a file-count cap, checked on lease release (over quota → no new leases + banner; a running job is never killed).
- Rev 2 tamper check: at job start `tree_hash` (incremental, bounded by `WORKSPACES_HASH_TIMEOUT_SEC`) must equal the value recorded at lease grant, else `failed: workspace changed before start`.
- Commit-builder design (kept in rev 3, §7.1): ephemeral unnamed Oxen workspace on a safe branch `mice/ws/<id>-<seq>` (jobs `mice/job/<id>`) at `base_commit`; alternatives rejected because `PUT /file/<branch>/<dir>` commits one directory per call and `DELETE /file` one removal per call (non-atomic).
- Rev 2 risk list: big-bang replacement of Oxen workspaces (phased, old UI removed last); update-from-branch is path-level, not content merge (explicit conflicts, `ours|theirs`); Oxen behaviour unverified (fallback per-directory `PUT /file` commits, non-atomic caveat).
- Rev 2 test cases TC-WS-01…20 are replaced by the rev 3 test plan (§13); do not reuse their numbers.

### 18.2 Conflicts: rev 2 vs rev 3

| Rev 2 | Rev 3 (wins) |
| --- | --- |
| Storage `AUTH_DATA_DIR/workspaces/<id>/tree` cloned per workspace, Docker **host-path bind** (`WORKSPACES_HOST_DATA_DIR`) | Overlay (`upper` over a shared per-commit checkout) on two Docker **named volumes** (`mice-store`, `mice-workspaces`), §2; host paths only resolved from `docker volume inspect` |
| Create = full clone via `materializeCommitClone` | `ensureCheckout` incremental, hardlinked, single-flight (§3); create copies nothing |
| Phases W0–W6 (W0 store … W6 remove Oxen usage) | Phases W0–W7 (W0 spike, W1 checkout store, W2 workspace store, W3 leases, W4 commit builder, W5 jobs/sessions, W6 CLI/UI, W7 Kubernetes), §12 |
| Kubernetes: RWX PVC `WORKSPACES_PVC` (hostPath for single-node dev) | Not in this iteration; `copy`/`reflink` driver meanwhile, overlay is W7 (§4.3) |
| Manifest cache `manifest.json`, live diff by re-hashing the tree | Diff from `upper` + manifests, never walking the lower tree (§5.1, I2) |
| `/api/repos/*/workspaces/*` "stays reachable but unused" | Oxen workspaces renamed **Stages**, a separate supported feature (§17) |
| Existing Oxen workspaces ignored | Oxen workspaces are kept as Stages (D1: no migration of them into Mice workspaces) |
| Backup/DR, fencing, notifications not covered | Open requirements, unchecked (§15) |
