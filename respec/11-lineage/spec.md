Status: ready-for-agent

# 11 — File lineage and operation graph (PLAT-TRACE)

## Problem Statement

Auditors and scientists need to know where each file version came from: which operations, jobs and inputs produced it.

## Solution

A lineage graph of file operations and job edges, written as a fail-closed intent-style record under `GXP_STRICT`, stored in PostgreSQL, keyed by stable repository id.

## User Stories

1. As a scientist, I want to see what produced a file version, so that I can reproduce it.
2. As a scientist, I want to see jobs and their inputs and outputs in one graph, so that I follow data flow.
3. As an auditor, I want imports in lineage and uploads recorded without origin fields, so that provenance gaps are explicit rather than invented.
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
- Retention: forever; nothing is hard-deleted. Superseded records are marked `superseded_by` and hidden by default, with an `as_of` view.
- Corrections require a reason and an e-signed approval by a different Principal; the chain is shown.
- Shared version-ref types with jobs.

## Testing Decisions

- HTTP tests of graph queries after mutations, strict-mode failure, rename survival.
- Prior art: lineage API tests.

## Out of Scope

Separate lineage retention. Lineage export is an NDJSON snapshot included in the audit bundle (Q24), not a separate packaging feature.

## Further Notes

Overlaps with audit; keep one writer path.

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Write path and integrity
- Intent-time stub; outputs completed at Outcome; reconciler fills gaps (Q1).
- Op hash lives in immudb; lineage tables are a derived index (Q12).
- Store failure refuses the mutation; classification failure records an unclassified gap op; unclassified routes are blocked (Q25).
- Unique (repo, path, hash, commit) with precedence upsert; lock on rebuild (Q7).
- Reconcile from the commit parent with a conditional write returning 409 (Q14).

Graph model
- A commit diff emits per-path ops (explicit_by_diff) plus a commit node (Q2).
- Inferred edges are a distinct class, excluded from exports unless requested (Q3).
- Normalised op and version_ref tables, indexed, with bounded traversal (Q6).
- Op node plus edge table, paged; Jobs read I/O from lineage (Q15).
- Cross-repo edges by stable repository id; restricted-node stub (Q9).
- Commit-level merge, tag and branch; revert and restore per path; list unsupported (Q22).
- All metadata revisions are recorded in lineage (Q28).
- Desktop Session link only (Q17).
- Uploads: no origin fields; URL import disabled (Q16).

Queries, corrections and gaps
- Stable cursor, caps with truncated flag, depth up to 5, hub summary (Q20).
- Corrections need a reason and different-Principal e-signed approval; chain shown (Q4).
- Never delete; `superseded_by`, hidden by default, `as_of` (Q21).
- A gap is an auditable record: open, explained, QA-signed (Q19).
- Incremental per-branch scan, classification, allowlist, capture status (Q18).

Access and export
- Lineage follows repository access; redaction process; no identifiers in names (Q10).
- NDJSON snapshot export with manifest, hashes and ledger state, inside the audit bundle (Q24).

## Conflicts and open risks

- Q16 versus 06 Q15 and 06 Q7: 11 records no upload origin fields, while 06 captures client-asserted name and mtime and one lineage op per import; reconcile where client-asserted metadata is stored (owner: one owner per fact).
- Q4 versus 04 Q9 and 00 Q9: e-signed correction approval must obey no self-signing and "authored by" versus "signed by".
- Q3: inferred edges are excluded from exports by default; auditors must request them.
- Q12 versus 03: op hash in immudb adds a write per op; covered by the 03 latency budget (to be verified).
- Q10 and 00 Q8: redaction process cannot erase; legal sign-off on the retention stance is still needed.
- Q9: restricted-node stubs may leak existence across repositories (risk to review with 02).
- Q21 and 05 Q25: lineage uses stable repository ids; static physical names keep commit ids unchanged.
- No unresolved blocker; the Q16 versus 06 mismatch is a documentation alignment, not a gate.
