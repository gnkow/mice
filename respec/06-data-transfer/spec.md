Status: ready-for-agent

# 06 — Data import, export and large uploads (PLAT-DATA)

## Problem Statement

Users move large datasets in and out of repositories. Today chunk and import routes accidentally require `admin`, uploads are not resumable, imports can be abused for SSRF, and integrity evidence relies on a non-cryptographic hash.

## Solution

Explicitly authorised, streamed, audited and lineage-recorded transfer, with resumable uploads, a BFF-controlled egress-restricted fetcher for URL import, and SHA-256 manifests as integrity evidence.

## User Stories

1. As a writer, I want to upload large files in chunks, so that big datasets succeed.
2. As a writer, I want to resume an interrupted upload, so that I do not start over.
3. As a writer, I want chunk and import routes to need only `write`, so that I am not blocked by an accidental admin requirement.
4. As a writer, I want to import from a URL, so that I can pull public data.
5. As a security reviewer, I want URL import fetched by an egress-restricted BFF fetcher, so that internal services are unreachable.
6. As a security reviewer, I want redirects and DNS rebinding handled, so that filters cannot be bypassed.
7. As a writer, I want to supply import credentials as server-side references, so that secrets are not in browser state.
8. As an auditor, I want imports and uploads in audit and lineage, so that provenance is complete.
9. As an auditor, I want a SHA-256 manifest per transfer, so that integrity is verifiable.
10. As a reader, I want to export a directory or repository as an archive, so that I can work offline.
11. As an operator, I want request body limits and streaming, so that one request cannot exhaust memory.
12. As an operator, I want quotas on imports, so that storage is controlled.
13. As a reader, I want exports to need only read access.

## Implementation Decisions

- Chunk/import routes get explicit actions at repo `write`.
- URL import runs in a BFF-controlled fetcher with destination policy and egress firewall; the result is uploaded to oxen.
- URL import stays enabled; the destination policy is mandatory configuration.
- SHA-256 is authoritative; XXH3-128 stays oxen's identifier.
- Export reads are not separately audited.
- Quota location (BFF counters vs oxen accounting) is an implementation decision to resolve with the quota owner.
- Resume depends on oxen exposing received-chunk state; otherwise the BFF records offsets in PostgreSQL.

## Testing Decisions

- HTTP tests per role on chunk routes, SSRF cases (private IPs, redirects, rebinding), resume, manifest digest correctness.
- Prior art: TC-DATA-01/02 in the plan; existing upload tests.

## Out of Scope

Auditing export reads, SFTP or object-store connectors.

## Further Notes

Digest computation on large files costs CPU and time; stream it.
