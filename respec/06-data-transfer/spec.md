Status: ready-for-agent

# 06 — Data import, export and large uploads (PLAT-DATA)

## Problem Statement

Users move large datasets in and out of repositories. Today chunk and import routes accidentally require `admin`, uploads are not resumable, and integrity evidence relies on a non-cryptographic hash.

## Solution

Explicitly authorised, streamed, audited and lineage-recorded transfer, with resumable uploads and SHA-256 manifests as integrity evidence. URL import is disabled until its controls exist.

## User Stories

1. As a writer, I want to upload large files in chunks, so that big datasets succeed.
2. As a writer, I want to resume an interrupted upload, so that I do not start over.
3. As a writer, I want chunk and import routes to need only `write`, so that I am not blocked by an accidental admin requirement.
4. As a security reviewer, I want URL import disabled until allowlist, redirect re-validation, caps and provenance exist, so that SSRF is not exposed (global decision).
5. As a writer, I want imports to land on a branch and reach the default branch through a signed merge, so that there are no direct writes on main.
6. As a writer, I want archive uploads unpacked in a streaming way with limits, so that malicious archives are rejected.
7. As an auditor, I want imports and uploads in audit and lineage, so that provenance is complete.
9. As an auditor, I want a SHA-256 manifest per transfer, so that integrity is verifiable.
10. As a reader, I want to export a directory or repository as an archive, so that I can work offline.
11. As an operator, I want request body limits and streaming, so that one request cannot exhaust memory.
12. As an operator, I want quotas on stored bytes, so that storage is controlled.
13. As a reader, I want exports of an explicit commit to need Read by default, with a separate export action, so that exfiltration is controllable.

## Implementation Decisions

- Chunk/import routes get explicit actions at repo `write`.
- URL import is disabled (00 Q15). Before re-enabling, entry criteria (allowlist, redirect re-validation, caps, provenance) must be defined.
- Imports land on a branch and merge; no direct writes on the default branch.
- SHA-256 is authoritative; XXH3-128 stays oxen's identifier.
- Export reads are audited (all reads are audited); the export is a separate action, default-included with Read, with size and rate alerts.
- Quota uses Postgres reservation rows with a filesystem quota backstop; quota is stored bytes including history.
- Resume depends on oxen exposing received-chunk state; otherwise the BFF records offsets in PostgreSQL. Bounded parallel larger chunks are in scope and depend on a spike for oxen out-of-order chunk support.

## Testing Decisions

- HTTP tests per role on chunk routes, resume, manifest digest correctness, hash-mismatch failure and cross-repo hash reachability. SSRF tests are moot while URL import is disabled.
- Prior art: TC-DATA-01/02 in the plan; existing upload tests.

## Out of Scope

URL import (disabled), malware scanning (customer control; scanner hook is an extension point), SFTP or object-store connectors.

## Further Notes

Digest computation on large files costs CPU and time; stream it.

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Upload lifecycle and audit
- Intent at create, Outcome at complete or abandon; chunk hashes on the Outcome (Q2).
- Manifest and per-file digests go in the Outcome event in immudb; BFF signing later (Q4).
- One lineage op per import references the manifest, in the same transaction as the Outcome projection (Q7).
- Head is captured only at complete; chunks take no lock (Q17).
- Incomplete uploads expire by TTL with an audited "abandoned" Outcome, a carve-out from retain-forever (Q18).
- Hash mismatch fails the upload with a failure-class Outcome, notifies admin, no override, patterns reported (Q24).
- The BFF derives a manifest and Outcome per push and clone at commit level (Q25).

Archives, quotas, metadata
- Streaming unpack with limits; special entries rejected; rejections audited (Q12).
- Quota: Postgres reservation rows plus filesystem backstop; stored bytes including history (Q13).
- Malware scanning is out of scope (customer control) with a scanner hook (Q14).
- Client mtime and name captured, labelled client-asserted; guidance keeps the instrument original (Q15).
- Verify hash reachability from the named repo; cross-repo test (Q22).

Export
- Export of an explicit commit; the manifest declares the Pin, counts, and omitted or denied paths (Q6).
- Pin then export; manifest first plus trailing checksum; resumable ranged download of the prepared artifact (Q20).
- Separate "export" action (default included with Read) plus size and rate alerts (Q21).

Throughput
- Bounded parallel larger chunks now, needing an oxen out-of-order chunk spike (Q19).

URL import
- Disabled; Q8, Q9, Q10, Q11, Q28 are moot until re-enabled (Q8-Q11, Q28).

Inherited (not restated): Q1, Q3, Q5, Q16, Q23, Q27.

## Conflicts and open risks

- Q19: owner chose parallel chunks first although the recommendation was targets first. Depends on oxen out-of-order chunk support. RISK.
- Q9: entry criteria for re-enabling URL import are not defined. DEFERRED.
- Q26: remaining tests are assumed per recommendation; owner to confirm. PENDING.
- Q18 carves incomplete transfers out of retain-forever; confirm with 03-audit retention. RISK.
- Q21 reverses the old "exports not separately audited" line; the spec follows 00 Q4 (all reads audited).
- Q4 defers BFF signing of manifests. DEFERRED.
- Q1 requires imports through branch plus signed merge (05 Q11, 04); bulk import flows need a merger other than the uploader (02 Q1).
- Q25: per-push and clone manifests add load; derived data must be reconcilable via the Postgres outbox.
