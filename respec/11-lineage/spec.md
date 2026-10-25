Status: ready-for-agent

# 11 — File lineage and operation graph (PLAT-TRACE)

## Problem Statement

Auditors and scientists need to know where each file version came from: which operations, jobs and inputs produced it.

## Solution

A lineage graph of file operations and job edges, written as a fail-closed intent-style record under `GXP_STRICT`, stored in PostgreSQL, keyed by stable repository id.

## User Stories

1. As a scientist, I want to see what produced a file version, so that I can reproduce it.
2. As a scientist, I want to see jobs and their inputs and outputs in one graph, so that I follow data flow.
3. As an auditor, I want imports and uploads in lineage, so that provenance has no gaps.
4. As an auditor, I want a gap between an oxen commit and its lineage record detected, so that missing records are found.
5. As a reviewer, I want to correct a derived move or copy with an additive record, so that the original stays visible.
6. As a compliance lead, I want lineage writes to fail closed in strict mode, so that provenance is never missing.
7. As a user, I want to filter lineage by kind, job and commit, so that large graphs are manageable.
8. As a repository admin, I want lineage to survive rename and transfer.
9. As an auditor, I want lineage included in the audit export package or linked from it.

## Implementation Decisions

- Lineage is a first-class record in PostgreSQL, not a disk file.
- Under `GXP_STRICT` the lineage write is part of the intent/outcome flow and refuses the mutation on failure.
- Gap detection compares oxen commits with explicit operations and intent records.
- Retention: until deleted; repository deletion removal policy undecided and left for implementation review.
- Who may correct derived operations and whether a signature is needed is open; default is repo admin without signature.
- Shared version-ref types with jobs.

## Testing Decisions

- HTTP tests of graph queries after mutations, strict-mode failure, rename survival.
- Prior art: lineage API tests.

## Out of Scope

Separate lineage retention, lineage export packaging.

## Further Notes

Overlaps with audit; keep one writer path.
