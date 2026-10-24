# DATA TRANSFER — PLAT-DATA implementation plan

Living design and phased plan for epic `PLAT-DATA` ("Data import, export & large uploads"): moving bytes into and out of oxen-server repositories through the auth BFF. Features here **already exist in code** but had no plan; this document records what is verified, what is missing, and what is *proposed, not approved*.

Related: [EPICS.md](./EPICS.md) · [01-authentication.md](./01-authentication.md) · [02-authorization.md](./02-authorization.md) · [03-audit.md](./03-audit.md) · [04-gxp-compliance.md](./04-gxp-compliance.md) · [05-repositories.md](./05-repositories.md) · [07-cli.md](./07-cli.md) · [08-workspaces.md](./08-workspaces.md) · [11-lineage.md](./11-lineage.md) · [README.md](../README.md)

## 1. Purpose & scope

**In scope**

- Browser upload: single/multi-file commit upload, chunked large-file upload, zip unpack
- Browser export/download: zip of a branch or path, batch download by content hash
- Import from URL (server-side fetch by oxen-server)
- CLI transfer via `mice push` / `mice clone` through the BFF
- How the BFF treats transfer bodies (size, buffering, content types), authorizes, audits and attributes them

**Out of scope**

- Authentication, PATs, CSRF — [01-authentication.md](./01-authentication.md)
- Role model and path→role mapping — [02-authorization.md](./02-authorization.md)
- Audit store, CSV export of the audit log (`/auth/audit/export.csv`) — [03-audit.md](./03-audit.md)
- Repository lifecycle, branches, merge — [05-repositories.md](./05-repositories.md)
- Workspace staging internals — [08-workspaces.md](./08-workspaces.md)
- Lineage graph model — [11-lineage.md](./11-lineage.md)

## 2. Current state

| Piece | Behavior | Where |
| --- | --- | --- |
| Upload UI | "Upload" modal opened by `?manage=upload` on the tree page; size-aware: below the threshold a direct commit (`PUT …/file/…`), at/above it the chunked flow; multi-file; optional commit message and destination directory; optional staging into a workspace | [`ManageFilesMenu.tsx`](../web/src/components/ManageFilesMenu.tsx), [`TreePage.tsx`](../web/src/pages/TreePage.tsx) |
| Legacy route | `/upload` redirects to the tree page with the upload modal (`path`/`dst` → destination) | [`LargeUploadPage.tsx`](../web/src/pages/LargeUploadPage.tsx) |
| Large upload | Threshold and chunk size both 4 MiB; whole-file XXH3-128 hash computed client-side (hash-wasm, streamed in 4 MiB slices); `POST …/versions/{id}/create` → sequential `PUT …/versions/{id}/chunks?offset=N` (`application/octet-stream`) → `POST …/versions/{id}/complete` (optional `workspace_id`) | [`web/src/lib/oxen/api.ts`](../web/src/lib/oxen/api.ts) (`uploadLargeFile`, `UPLOAD_LARGE_THRESHOLD`), [`hash.ts`](../web/src/lib/oxen/hash.ts) |
| Progress | `onProgress` phases `hash` / `create` / `chunks` / `complete` with bytes and chunk counts; modal shows per-file phase and percentage | `LargeUploadProgress` in `api.ts`; [`ManageFilesMenu.tsx`](../web/src/components/ManageFilesMenu.tsx) |
| Zip import | `POST …/import/upload/{branch}/{dir}` multipart (`file`, `commit_message`); server unpacks and commits | `uploadZipArchive` in `api.ts`; [`ImportExportPage.tsx`](../web/src/pages/ImportExportPage.tsx) |
| URL import | `POST …/import/{branch}/{dest}` JSON (`download_url`, optional `filename`, optional `auth` header value, `message`); oxen-server performs the fetch | `importFromUrl` in `api.ts`; `ImportExportPage.tsx` |
| Export | `GET …/export/download/{branch}/{path}` → zip held in memory as a `Blob`, then saved via `triggerDownload` (empty path = whole branch) | `exportZip` in `api.ts`; `ImportExportPage.tsx` |
| Download by hash | `QUERY …/versions` with a gzip line-delimited hash list (`CompressionStream`) → `.tgz`; single blobs unpacked by a minimal ustar reader | `downloadVersionsTarball`, `downloadVersionByHash` in `api.ts`; [`tar.ts`](../web/src/lib/oxen/tar.ts) |
| Error handling | One busy flag, one error banner; `OxenApiError` message or generic text; chunk failure surfaces response text and aborts the loop (no retry) | `run()` in `ImportExportPage.tsx`; `uploadLargeFile` |
| BFF body handling | JSON, multipart, `application/octet-stream`, `application/gzip` are read **fully into memory** (`formData()` / `text()` / `arrayBuffer()`) then forwarded; any other non-empty body is rejected (`unclassified_body`); no BFF-side size limit found; responses are streamed back (`upstream.body`) | [`auth/src/proxy.ts`](../auth/src/proxy.ts) |
| Hop headers | `connection`, `transfer-encoding`, `content-length`, `host`, `cookie`, `authorization`, etc. stripped from requests and responses | `HOP_BY_HOP` in `proxy.ts` |
| Author injection | JSON and multipart bodies get author name/email overwritten from the session/PAT principal; octet-stream/gzip accepted **only** on an allowlist: `PUT …/versions/{id}/chunks` and `QUERY …/versions`; author in query string is rejected. The client sends placeholder `mice@localhost` values | [`auth/src/author.ts`](../auth/src/author.ts), `proxy.ts`, `authorFields()` in `api.ts`; [ADR 0001](../docs/adr/0001-bff-identity-trust-model.md) |
| AuthZ | Reads (`GET`/`HEAD`, incl. export download) need `read`; `PUT …/file/**` needs `write`; **any other mutating route needs `admin`** | `interpretRequest` in [`auth/src/requestInterpretation.ts`](../auth/src/requestInterpretation.ts); [`authzPathMap.ts`](../auth/src/authzPathMap.ts) |
| Audit | `PUT …/file/**` → `file.write`; mutating requests are audited with actor and `via`. `import/*` and `versions/*` have no dedicated `classifyPath` action (fall to `other`) | `classifyPath` in [`auth/src/requestInterpretation.ts`](../auth/src/requestInterpretation.ts) |
| Lineage | Only `…/file/**` writes produce explicit ops (`upload`, `edit`, `restore`, `move`, `rename`, `copy`) with before/after content hash; chunked, zip and URL imports produce none | `classifyFileLineageOp` in [`auth/src/lineage.ts`](../auth/src/lineage.ts) |
| CLI | `mice push` / `mice clone` / other Oxen subcommands forwarded to the `oxen` binary after configuring auth for the BFF host; `:3001` URLs rewritten to the BFF remote; `mice push` then publishes pending local job metadata | [`cli/lib/oxen.mjs`](../cli/lib/oxen.mjs) (`runOxenPassthrough`, `looksLikeDirectOxenServer`, `oxenPush`), [`cli/lib/publish.mjs`](../cli/lib/publish.mjs); README "Mice CLI" |
| E2E | Multi-file upload (TC-F-13), chunked path (L-01), workspace-staged large upload (L-02) | [`e2e/tests/large-upload.spec.ts`](../e2e/tests/large-upload.spec.ts) |

Not found in code: resume of an interrupted chunked upload, per-chunk retry, parallel chunks, cancel button wired to `signal` in the modal, quotas, malware scanning, allow/deny lists for import URLs, S3/Hugging Face import, e2e coverage of zip/URL import and export.

## 3. Goals & non-goals

### Goals (proposed, not approved)

1. Make large transfers reliable (resume, retry) and verifiable (end-to-end integrity)
2. Make every bulk transfer attributable, authorized at the right role, and visible in audit and lineage
3. Bound resource use at the BFF (body size, memory, quota)
4. Give GxP users integrity evidence for data in and out ([04-gxp-compliance.md](./04-gxp-compliance.md))

### Non-goals

- Replacing oxen-server's storage or its chunk protocol
- A general ETL/pipeline engine (see jobs, [09-jobs.md](./09-jobs.md))

## 4. Verified behaviour & known gaps

### Observations from the code (read, not run)

- **BFF buffers whole bodies.** A 5 GB zip upload (`import/upload`) is held in BFF memory; chunked upload bounds this to 4 MiB per request, which is the only reason large files are practical. No `bodyLimit` or env knob was found.
- **Role mismatch (likely bug, unconfirmed at runtime).** `classifyPath` does not map `versions/*` or `import/*` to a named action, so `requiredRepoRoleForRequest` demands `admin` for chunk create/PUT/complete, URL import, zip import and `QUERY …/versions`, while small uploads need only `write`. A `write` user may therefore be able to upload a 3 MiB file but not a 5 MiB one.
- **Not attributed in lineage/audit detail.** Chunked `complete`, zip and URL imports are audited as generic `other` and absent from the lineage graph.
- **Author injection coverage.** Chunk and hash routes are author-free by design (no commit is created there); the commit-creating `complete` call is JSON and gets injected author fields. Zip/URL import bodies are injected as multipart/JSON.
- **SSRF surface.** URL import is fetched by oxen-server using a user-supplied URL and optional auth header; the BFF applies no destination filtering.
- **Progress ≠ resumable.** Every attempt restarts from hash → create → chunk 0.

## 5. Phased plan

### Phase 0 — Shipped baseline (verified in code)

- [x] Size-aware upload modal (direct commit below 4 MiB, chunked at/above) — `ManageFilesMenu.tsx`, `UPLOAD_LARGE_THRESHOLD`
- [x] Multi-file upload with destination directory and commit message
- [x] Chunked upload: client-side XXH3-128 version id, create/chunks/complete — `uploadLargeFile`
- [x] Progress reporting by phase, bytes and chunk count — `LargeUploadProgress`
- [x] Optional staging of a large upload into a workspace (`workspace_id` on complete)
- [x] Zip export of a branch or path; zip upload-and-unpack; URL import; download by content hash — `ImportExportPage.tsx`
- [x] Author overwritten server-side for JSON/multipart; octet-stream/gzip only on allowlisted routes — `author.ts`, `proxy.ts`
- [x] Responses streamed back through the proxy; hop-by-hop headers stripped — `proxy.ts`
- [x] `PUT …/file/**` uploads audited (`file.write`) and recorded as lineage `upload`/`edit` with content hashes
- [x] CLI push/clone through the BFF with `:3001` rewrite — `cli/lib/oxen.mjs`
- [x] E2E for multi-file, chunked and workspace-staged chunked upload — `large-upload.spec.ts`

### Phase 1 — Correctness and attribution (proposed, not approved)

- [ ] Confirm the `admin`-for-chunks behaviour with a `write`-role e2e (TC-DATA-01) and, if confirmed, add `versions`/`import` actions to `classifyPath` with `write` for upload and `read` for `QUERY …/versions` — keep `authzPathMap.ts` in sync (proposed, not approved)
- [ ] Dedicated audit actions (`file.upload.chunked`, `import.zip`, `import.url`, `export.zip`, `versions.download`) with size, hash and destination in `detail` (proposed, not approved) — see [03-audit.md](./03-audit.md)
- [ ] Lineage ops for chunked, zip and URL imports (new kinds or `upload` with `source` detail) — see [11-lineage.md](./11-lineage.md) (proposed, not approved)
- [ ] Audit exports (zip/hash downloads) so reads of bulk data are attributable (proposed, not approved)

### Phase 2 — Limits and safety (proposed, not approved)

- [ ] BFF `bodyLimit` per content type, env-configurable, with a clear `413` and audit of rejections (proposed, not approved)
- [ ] Stream non-JSON bodies instead of `arrayBuffer()` where the author-free allowlist applies (proposed, not approved)
- [ ] URL import destination policy: deny private/link-local ranges, scheme allowlist, size cap, redirect handling (proposed, not approved)
- [ ] Per-namespace/repo quota checked at `create` (declared `size`) (proposed, not approved)
- [ ] Virus-scan hook: pluggable pre-`complete` check (ICAP/clamd) that can quarantine a version id (proposed, not approved)

### Phase 3 — Reliability (proposed, not approved)

- [ ] Resume: persist `{versionId, offset}` per file (IndexedDB) and continue after reload; needs a server query for received chunks or a safe restart from last acknowledged offset (proposed, not approved)
- [ ] Per-chunk retry with backoff; honour `AbortSignal` through a visible Cancel button (proposed, not approved)
- [ ] Bounded parallel chunk upload (proposed, not approved)
- [ ] Streamed zip export (avoid in-memory `Blob` for large trees) (proposed, not approved)

### Phase 4 — Integrity evidence and new sources (proposed, not approved)

- [ ] Post-upload verification: compare client XXH3-128 with server-reported hash and surface the result (proposed, not approved)
- [ ] Add a cryptographic digest (SHA-256) alongside XXH3 for GxP evidence; export manifest (path, size, hashes, commit, actor, time) with every zip/tarball (proposed, not approved) — see [04-gxp-compliance.md](./04-gxp-compliance.md)
- [ ] Import from S3 / Hugging Face with credentials held server-side, never in browser form fields (proposed, not approved)
- [ ] Additional export formats (tar.gz, per-file CSV/Parquet) (proposed, not approved)
- [ ] CLI parity: `mice upload|export|import` JSON commands using PATs — see [07-cli.md](./07-cli.md) (proposed, not approved)

## 6. Test plan

| ID | Scenario | Status |
| --- | --- | --- |
| TC-F-13 | Multi-file upload via Manage Files (existing e2e) | Implemented |
| L-01 | Chunked path used for a >4 MiB file (existing e2e) | Implemented |
| L-02 | Large upload staged into a workspace (existing e2e) | Implemented |
| TC-DATA-01 | `write`-role user completes a chunked upload (expect success; documents role gap) | Proposed, not approved |
| TC-DATA-02 | `read`-role user: export zip allowed, import/upload denied `403` | Proposed, not approved |
| TC-DATA-03 | Zip upload → commit author equals session user, not client placeholder | Proposed, not approved |
| TC-DATA-04 | URL import happy path and private-address rejection | Proposed, not approved |
| TC-DATA-05 | Oversized body → `413`, audited | Proposed, not approved |
| TC-DATA-06 | Interrupted chunked upload resumes without re-sending acknowledged chunks | Proposed, not approved |
| TC-DATA-07 | Uploaded hash mismatch fails verification | Proposed, not approved |
| TC-DATA-08 | Each bulk operation yields one audit event and (where applicable) a lineage op | Proposed, not approved |
| TC-DATA-09 | Export zip includes manifest with hashes | Proposed, not approved |

## 7. Open questions

1. Is the `admin` requirement for chunked upload intended, or an accident of `classifyPath` falling through to `other`?
2. Does oxen-server expose received-chunk state, or must resume restart from a client-recorded offset?
3. Should URL import be disabled by default (`DATA_IMPORT_URL_ENABLED`) until a destination policy exists?
4. Which digest is authoritative for GxP evidence: oxen's XXH3-128 version id or an added SHA-256?
5. Should reads of bulk exports be audited for all roles or only above a size threshold?
6. Where should quota live: BFF counters or oxen-server storage accounting?

## 8. Risks

| Risk | Impact | Mitigation (proposed, not approved) |
| --- | --- | --- |
| Whole-body buffering in BFF | Memory exhaustion by a single large zip/multipart request | Body limits, streaming, reverse-proxy cap |
| URL import SSRF | Reaching internal services from oxen-server's network | Destination policy; egress firewall |
| Auth header typed into import form | Secret in browser state and request body | Server-side credential references |
| Silent role gap on chunk routes | Writers blocked or, if "fixed" carelessly, over-permitted | Explicit action classification plus TC-DATA-01/02 |
| Imports invisible to lineage/audit detail | Gaps in GxP data-provenance evidence | Phase 1 audit and lineage items |
| Non-resumable uploads | Wasted bandwidth, user abandonment on large files | Phase 3 |
| XXH3 is non-cryptographic | Weak integrity evidence | Add SHA-256 manifest |
