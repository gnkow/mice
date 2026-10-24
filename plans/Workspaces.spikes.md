# Workspaces — W0 spike findings

Run on 2026-10 against Docker Desktop (macOS, arm64): Docker 29.5.3, linuxkit kernel 6.12.76, Oxen server 0.61.1.

## Verdict: Docker-volume overlay WORKS on Docker Desktop

- A named volume created with `--opt type=overlay --opt device=overlay --opt o=lowerdir=…,upperdir=…,workdir=…,userxattr` mounts correctly. Paths are the VM-side `docker volume inspect` Mountpoints (`/var/lib/docker/volumes/<vol>/_data/...`), because the Docker daemon (not the BFF container) resolves them.
- Kernel mounted it as `redirect_dir=nofollow,uuid=on,userxattr`. Backing fs is ext4.
- Copy-up works (file appears in upper with `user.overlay.origin`); lower is untouched. New files land in upper.
- Whiteout = **character device 0/0** in upper (not an xattr) on this kernel. `scanUpper` handles both that and the `user.overlay.whiteout` xattr form.
- `rm -r d; mkdir d` makes `d` opaque: xattr `user.overlay.opaque=y`. Upper root also carries `user.overlay.uuid` / `impure`.
- A second container mounting the same volume `readonly` is enforced ("Read-only file system") and sees live writes from the rw container.
- `docker volume rm` fails while a container uses the volume and works afterwards.
- Reflink: `ENOTSUP` on the volumes (ext4) → driver falls to overlay, then `copy`.

## getfattr

- Not present in the auth image (node:22-alpine, busybox has `setfattr` only). `apk add attr` fails on this corporate-TLS network, so the Dockerfile was NOT changed. Node has no xattr API.
- Consequence: opaque directories cannot be detected → scan treats them as merged and emits a warning (`/auth/workspaces/:id/changes` `warnings`). Fix later: add `attr` to the image (or use a probe container). The capability probe reports `getfattr.ok=false`.
- Python `os.listxattr` works in `python:3.13-slim` (alternative if needed).

## Oxen listing facts

- `GET /api/repos/:ns/:repo/dir/<rev>/<path>?page=&page_size=` is **non-recursive**; `recursive=true` is ignored. `page_size` up to 5000 honored; fields `page_number`, `total_pages`, `total_entries`.
- `dir.hash` = directory hash, `dir.size` = recursive bytes. Entries: `filename`, `hash`, `is_dir`, `size`, `data_type`.
- Directory hashes are **stable across commits** when the subtree is unchanged → dir-hash prune is valid.
- File hashes are xxh3-128 of content, hex **not zero-padded** (e.g. 31 chars); equal for equal content at different paths. Compare as opaque strings only (not sha256/md5). The store computes its own sha256 while downloading.
- Revision → commit: `GET /api/repos/:ns/:repo/revisions/<branch-or-commit>` → `resource.commit.id`. `GET …/branches/main` → `commit_id`. `GET …/commits/<id>` works for ids only (`commits/main` is 404). `dir/<commitId>/…` works.
- `GET …/file/<rev>/<path>` returns raw bytes; `dir/<rev>/<file>` is 404 for files.
- `PUT …/file/<branch>/<fullpath>` takes the full path in the URL (multipart filename ignored; empty path = 400).

## Implementation notes / deviations

- `.oxen` entries named exactly `.oxen` are skipped (counted in meta), not build-aborting; `..`, `/`, `\`, NUL, empty names abort with 422.
- Resume uses a per-repo durable journal `store/index/<ns>/<repo>.tsv` (oxen hash → sha256) plus existing manifests.
- GC safety relies on "link or re-download" instead of a GC lock.
- Archive is computed by the BFF from upper + checkout (no wsctl needed yet).

## W3 findings (leases, mounts, real kernel)

- Per-generation volume `mice-ws-<id>-g<gen>` is created with `docker volume create --driver local -o type=overlay -o device=overlay -o o=lowerdir=…,upperdir=…,workdir=…,userxattr`; host paths come from `docker volume inspect` Mountpoint of `mice-store` / `mice-workspaces` (inside the Docker Desktop VM; verified working from the auth container, same as the W0 probe).
- Real-kernel results (`auth/scripts/ws-integration.mjs`, alpine container with rw mount): new file → `added`; modified lower file → `modified`; deleted lower file → whiteout → `removed`; `rm -r dir && mkdir dir` → opaque dir → lower children reported `removed`; no warnings. Lower checkout checksums unchanged (I4).
- A second container with the same volume `--mount …,readonly` sees the writer's changes; write, touch, mkdir and rm all fail.
- Read lease during a write lease works; second write lease → 423 with holder; workspace delete while leased → 423.
- After release and container exit `docker volume rm` succeeds; container-created upper files are deletable by the BFF (root in the auth container) → workspace dir removed (TC-WS-22).
- `getfattr` (package `attr`) is not available in the image, so `mice-xattr` (static Go, `unix.Llistxattr/Lgetxattr`, getfattr-compatible output) is copied in; the scan falls back to it, so the degraded-opaque warning is gone.
- Scan cache (3 s) made `changes` stale right after container writes; `changes` now forces a rescan.
- Containers run with `--user WORKSPACES_UID:GID` only when configured; MountSpec carries `user` and `umask: "0002"`.

## Findings still to gather (all unchecked)

- [ ] **Production Kubernetes overlay validation:** on a real cluster (not Docker Desktop), verify whether a pod can mount overlay with `userxattr` via a node DaemonSet/CSI-style publish or in-pod fuse-overlayfs; kernel ≥ 5.11 and ext4/xfs `d_type` on node disks; behaviour on RWX PVC (NFS/CSI) with the `copy`/`reflink` fallback; copy-up/whiteout/opaque markers and read-only second mount; pod security (no privileged escalation); node drain/reschedule while a lease is held. Feeds W7 in [Workspaces.md](./Workspaces.md) §12
- [ ] **Backup and recovery:** snapshot/restore of `mice-workspaces` (`upper`, `state.json`, `base.json`) and `store/index` journals while a writer is active and while idle; whether overlay generation volumes can be recreated from state after restore; rebuild of `store/commits` from Oxen after losing `mice-store`; measured restore time vs. workspace size; what is lost for a failed job's partial output. Feeds the backup/DR requirement in Workspaces.md §15

## W5-sessions findings (workspace mounts in desktop sessions)

- Real stack (`auth/scripts/ws-sessions-integration.mjs`, rdesktop image, Docker Desktop): session A rw → write lease; session B rw → degraded to ro with notice naming A; both reach `ready`; A writes through `/data/<ns>/<repo>` and `changes` reports added/modified/removed (whiteout) correctly; B sees the new file and cannot write; workspace delete → 423 naming both sessions; `session_count` 2; `?workspace_id=` filter works.
- Stop A removes its container and releases the write lease; `POST /sessions/B/remount` then upgrades B to rw and the upper persisted across the new container.
- A stopped Docker container still holds its volumes, so stop/destroy `rm` the container before releasing leases (otherwise `docker volume rm` on workspace delete would fail).
- rdesktop's init needs root, so ownership uses `PUID`/`PGID` env (from WORKSPACES_UID/GID, default 1000) plus `UMASK=002` instead of `--user`.
- Background provisioning has no group info for the owner, so authz is checked at create/retry/connect, not inside the provisioner.
