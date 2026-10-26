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

---

# Open Questions


Status: spec is `ready-for-agent`; lineage exists in PostgreSQL but is written best-effort after oxen accepts the mutation, keyed by namespace and repo names, with no stable repository id.
Biggest risks: "fail-closed" lineage is impossible to deliver for a write that is recorded after the mutation, a data model that scans a whole repo per append, and derived edges that can be mistaken for evidence or deleted.
Tags: [Domain] = regulated-science/GxP concern, [Impl] = engineering concern.

## Q1 [Impl] A lineage write that depends on the mutation's result cannot "refuse the mutation" under strict

The spec says that under `GXP_STRICT` the lineage write is part of the intent/outcome flow and refuses the mutation on failure. The existing explicit capture happens after oxen accepts the mutation, because output hashes and the commit id are only known afterwards, and a failed append is logged and swallowed. Refusing after oxen has already committed does not undo the commit. Only the Intent side (what is about to happen) can be recorded before the mutation, and that cannot contain the outputs.
Example: a user uploads `plate7.csv`; oxen commits `c9f1`; the lineage insert fails because PostgreSQL has a connection blip. The BFF returns 503, the client retries, and a second commit `d204` contains the same file, with one lineage op instead of two.
Options: (a) Intent-time lineage stub (inputs, intended paths) stored before the mutation, with outputs completed in the Outcome step by the reconciler if the final write fails; (b) lineage derived entirely from Intent and Outcome events in the audit trail (no separate write); (c) keep best-effort and detect gaps (Q18).
Recommendation: (a), and state that the guarantee is "no mutation without an Intent-time lineage stub", not "no commit without final lineage".
Challenges: Spec "lineage write is part of the intent/outcome flow and refuses the mutation on failure"; user story 6.

## Q2 [Impl] Multi-file mutations (push, Stage commit, Workspace merge, Job commit) have no per-file explicit capture

Explicit capture classifies single-file requests (upload, edit, move, delete). A push transports a pack of many files; a Stage or Workspace commit finalizes accumulated changes; a Job commit is created by the platform. The BFF sees one request and one commit, not 5,000 file operations. The spec's "imports and uploads in lineage, so provenance has no gaps" cannot hold for the bulk paths that scientists actually use.
Example: a scientist pushes 4,800 files from the oxen CLI in one commit. The proxy sees a transport request; lineage has no explicit ops, so the files appear only through low-confidence derivation or not at all.
Options: (a) at commit completion the BFF computes a diff against the parent and emits explicit ops per path (bounded, async, with marker `explicit_commit_diff`); (b) one commit-level op with a paged manifest; (c) classify those paths as derived only.
Recommendation: (a) at commit completion, storing a commit-level node plus path edges, and flag it `explicit_by_diff` so it is not confused with request-level capture.
Challenges: Plan §4 "Explicit emitter after successful upstream mutate"; spec user stories 3 and 4.

## Q3 [Domain] Derived edges can be read as fact by auditors and reviewers

Derived ops are inferred from path history and hash equality, with a `low` confidence on move and copy. An `edit` edge says the new version came from the previous version of the same path, which is true of history but says nothing about the actual data flow. Reviewers reading a graph may take every edge as provenance. ALCOA requires accurate records and clear distinction between recorded and inferred information.
Example: `model_v2.pkl` replaces `model_v1.pkl` at the same path; derivation draws an `edit` edge, while in reality it was trained from scratch from different data via a Job in another repo.
Options: (a) show derived edges in a visually and API-distinct class (`inferred`), excluded from audit exports unless requested; (b) hide derived edges by default; (c) keep both with badges (as decided).
Recommendation: (a), with the API requiring an explicit flag to include inferred edges and the export carrying a legend.
Challenges: Plan §3 "surface confidence" and §4 hybrid ingestion; spec story 1.

## Q4 [Domain] "Repo admin, no signature" may rewrite the provenance story and is not separation of duties

Correction of a derived move or copy is an additive record, and the spec's default allows a repo admin without a signature. The repo admin is often the person who performed the move or who benefits from the narrative. A correction that re-links an input changes what auditors believe about a result. Part 11 expects changes to records to be attributable, reasoned and not obscure the original.
Example: a repo admin re-links `final_report.pdf` from `draft_v3.docx` to `approved_v4.docx` to match what the SOP says, without a reason or reviewer.
Options: (a) corrections need a reason, and approval by a different Principal (maintain or QA role), with an e-signature under strict; (b) only the original actor or QA may correct; (c) as decided.
Recommendation: (a), displayed with both the original and correction chain, and the same signature mechanism as Merge+maintain.
Challenges: Spec "default is repo admin without signature"; plan §13 Q1.

## Q5 [Impl] Rename as copy+delete breaks commit-id continuity that lineage and Jobs rely on

Lineage and Jobs reference commit ids. When a repository is renamed by copying to a new oxen repo and deleting the old, the new repo's history either contains the same commits (if copied by push) or new ones (if recreated). Commit ids may or may not survive depending on how the copy is made, and the Pins referenced by Jobs, favorites and metadata point at ids in a deleted repo. The stable repository id keeps the Mice node but not oxen's identifiers.
Example: `lab/trials` is renamed to `lab/trials-v2`. A lineage op references `commitId a1b2` in a Job Pin; after the copy, `a1b2` does not exist in the new repository because the history was re-imported with new ids.
Options: (a) rename is implemented as push-with-history, with a verification step comparing commit ids and file hashes before delete; (b) store a commit-id mapping table from old to new for every renamed repo; (c) disallow rename for repos with lineage, use "transfer by alias" instead.
Recommendation: (a) with the verification and a mapping table (b) only if ids differ; never delete the source until verification is recorded.
Challenges: Cross-cutting "rename = copy+delete at BFF with stable repo id"; spec story 8.

## Q6 [Impl] Each lineage append loads every op of the repository, so cost grows with repo history

Appending an operation checks the single-producer invariant by reading all ops in the repository and indexing them in memory. Ops are stored as one JSON body per row filtered by namespace and repo names. This is O(total ops in the repo) per mutation and the graph query shape (path or content hash) cannot use an index.
Example: a repo with 2 million ops after a year of Job commits; every upload reads and parses 2 million rows (hundreds of MB) before writing; p95 upload latency climbs from 80 ms to 14 s.
Options: (a) normalized tables: operation, version_ref (repo id, path, content hash, commit), with indexes on (repo id, path) and (repo id, content hash), and a uniqueness rule for producers; (b) keep JSON but add indexed generated columns; (c) per-repo partitions.
Recommendation: (a), with graph traversal by recursive query bounded by depth and limit.
Challenges: Existing append and query design; spec "Lineage is a first-class record in PostgreSQL".

## Q7 [Impl] The single-producer invariant is a read-then-insert with no database constraint, unsafe with N instances

The rule "each file version has one producer; explicit may supersede derived" is checked in application code before insert. Two concurrent requests on one or more BFF instances, or a rebuild running while a mutation lands, can both pass the check and both insert, leaving two producers for one version or deleting the wrong one.
Example: instance A runs the rebuild for `lab/trials` while instance B records an explicit upload of `qc.csv`; both see no producer, A inserts derived, B inserts explicit, and later pruning deletes whichever it iterates first.
Options: (a) unique constraint on (repo id, path, content hash, commit) for producing ops, upsert with source precedence in one statement; (b) advisory lock per repo id around append and rebuild; (c) serialise lineage writes through a single worker.
Recommendation: (a), with (b) around rebuild only.
Challenges: Plan §4 "one producer per file version"; cross-cutting multi-instance rule.

## Q8 [Impl] Lineage identity uses oxen's non-cryptographic hash while SHA-256 is declared authoritative

Version refs are keyed by oxen's content hash (XXH3-128), and all copy and move heuristics, content-hash queries and the single-producer rule rely on it. The cross-cutting decision names SHA-256 as the authoritative integrity evidence. XXH3 is not collision-resistant against an adversary: a crafted file can share a hash with another, causing false lineage links or masking a modification.
Example: an insider creates a file with the same XXH3 hash as a QC-approved reference file; the move heuristic treats the swap as an unchanged file and the lineage shows continuity.
Options: (a) add SHA-256 to every version ref, computed at upload by the BFF and on first read for historical files, and use it for identity; (b) keep XXH3 as lookup and SHA-256 as verification evidence; (c) accept XXH3 for lineage.
Recommendation: (b) for new data now, with (a) backfilled lazily; the heuristics use SHA-256 when present.
Challenges: Cross-cutting "SHA-256 is authoritative digest"; plan §5 `contentHash`.

## Q9 [Domain] Lineage is scoped to one repository, but real provenance crosses repositories

The plan's non-goal is cross-repository lineage in v1, and stable repository ids make cross-repo edges possible. Scientists copy raw data into analysis repos, Jobs read repo A and commit into repo B, and URL imports bring external data. A graph that stops at the repo boundary shows "no inputs" for derived data. At the same time a cross-repo node leaks the existence and paths of repos the viewer cannot read.
Example: `analysis/cohort-A` was built by a Job reading `raw/cohort-A`. Lineage in `analysis` ends at the Job; an auditor tracing a figure cannot reach the raw data without knowing to look in another repository.
Options: (a) cross-repo edges stored with repo ids, shown as opaque stubs ("restricted node") when the viewer lacks read; (b) strictly per-repo with documented limits; (c) cross-repo only for instance admins.
Recommendation: (a), with stubs revealing only the repo id.
Challenges: Plan §3 non-goal "Cross-repository lineage"; spec user stories 2 and 3.

## Q10 [Domain] Lineage read access exposes personal data and sensitive paths beyond file content

Lineage records contain actor names, emails, paths (including deleted files), Job details and branch names. Access is "repo read", the same as file content, but lineage includes items a reader could not otherwise see: deleted paths, past actors, and content of file names that carry subject identifiers. After a repository transfer or a user losing access, who may read old lineage is unclear.
Example: a deleted file `patients/JD-0042_consent.pdf` remains in lineage forever; a new reader added to the repo sees the patient code and the name of the employee who deleted it.
Options: (a) path and actor display is governed by the same rules as history (current repo access) and redactable under a documented process; (b) lineage readable only by maintain and above; (c) as decided.
Recommendation: (a), and document that file names are not a safe place for identifiers.
Challenges: Plan §10 "Lineage read: repo read"; New gap on personal data.

## Q11 [Domain] Repository deletion versus "keep forever" is undecided and leaves dangling provenance

Retention is until deleted, and the removal policy on repository deletion is left for implementation review. If a repository is deleted but its lineage is kept, downstream repos point to nodes that cannot be opened; if lineage is removed, provenance for results in other repos is broken. GxP repositories normally cannot be deleted while records are retained.
Example: `raw/study-17` is deleted by its owner after the study; 12 derived repos reference its file versions, which now resolve to nothing.
Options: (a) repository deletion is a soft archive (hidden, read-only) while any retention class applies; hard delete requires a signed admin action and leaves tombstone nodes in lineage; (b) lineage is deleted with the repo; (c) lineage is kept and the repo is deletable.
Recommendation: (a), with tombstone nodes carrying repo id, deletion time and signer.
Challenges: Spec "repository deletion removal policy undecided"; cross-cutting "retention forever".

## Q12 [Domain] Lineage in PostgreSQL is not tamper-evident, so it cannot be the auditor's evidence on its own

The audit trail has immudb proofs; lineage is an ordinary PostgreSQL table. A database administrator, or a bug, can edit or delete rows without detection. Corrections, derived pruning and rebuilds already modify rows. Auditors reconciling lineage to the audit trail have no way to prove the lineage was not changed after the fact.
Example: an auditor compares lineage to the audit trail and finds that one `edit` op is missing; the team cannot show whether it was never written or was deleted.
Options: (a) each lineage op's hash is recorded in the Intent or Outcome event in immudb, making lineage verifiable against the ledger; (b) append-only table with deletion revoked at the role level and periodic hash checkpoints anchored in immudb; (c) accept as a convenience view and treat the audit trail as the only evidence.
Recommendation: (a), and treat the lineage tables as a derived index of the audit trail plus commit data.
Challenges: Spec "Overlaps with audit; keep one writer path"; ADR 0005 tamper evidence.

## Q13 [Impl] Reconciling an orphaned Intent by re-querying oxen conflicts with the rule not to guess outcomes from branch tips

The cross-cutting reconciler infers the result of an orphaned Intent by querying oxen. The existing dataset capture deliberately never guesses the head from the branch tip, because it might belong to someone else's concurrent change. For lineage, the reconciler must decide which commit (if any) corresponds to the user's intended upload, on a branch other people are writing to.
Example: Intent says "upload `a.csv` to `main` by Alice at 10:00:03". At 10:00:04 Bob also pushed. The reconciler sees two new commits; one touches `a.csv`, but with Bob's hash. It must not attribute Bob's commit to Alice's Intent.
Options: (a) match by expected content hash and path from the Intent (the Intent carries the SHA-256 and size of the upload), and mark `unresolved` if no unique match; (b) match by the tip commit and author; (c) require the BFF to hold a per-branch lock until the Outcome is written.
Recommendation: (a), plus `unresolved` as a visible terminal state requiring human closure (Q19).
Challenges: Cross-cutting reconciler decision; existing "head never guessed" posture.

## Q14 [Impl] The pre-mutation snapshot and head capture are not atomic with the mutation

Explicit edit capture fetches the current file entry before sending the mutation, and the dataset capture reads the branch head before and after. Both are separate calls. Another writer can change the file or branch between the snapshot and the mutation, so `inputs` and `{base, head}` may describe a version the user did not edit. The spec's extra "read plus lock" aims to close this, but a lock held across large uploads blocks others.
Example: Alice and Bob both edit `protocol.md`. Alice's snapshot sees hash H1; Bob commits H2; Alice's PUT is accepted on top, and lineage claims her edit was derived from H1 when in reality the file was H2.
Options: (a) conditional write: send expected parent hash and refuse with 409 if it changed (if oxen supports it, else enforce at BFF with lock); (b) reconcile inputs from the resulting commit's parent after the fact; (c) accept racy inputs and mark `low`.
Recommendation: (b) because it relies on committed truth, with (a) where the API allows it.
Challenges: Cross-cutting "extra oxen read+lock before/after every mutation"; plan §Phase 1 pre-mutate snapshot.

## Q15 [Impl] The single `job` op kind cannot represent large read and write sets or per-file edges

The plan documents that finer-grained job kinds (pin, produces, reads, writes) were not adopted; a Job is one op with inputs and outputs arrays of file versions, either of which may be huge. Graph queries by path need an edge, not a JSON array scan. The spec says "shared version-ref types with Jobs" and Jobs store the same lists again.
Example: a Job read 640,000 tiles; its `job` op has 640,000 inputs; a query for the lineage of one tile has to scan and parse that op, and the graph UI returns a 90 MB response.
Options: (a) op node plus an edge table (op id, direction, version ref) with paging; (b) store the manifest as a blob and expose only counts and a manifest hash in the graph; (c) cap and collapse to directory prefixes.
Recommendation: (a), with Jobs reading their I/O only from lineage (single writer).
Challenges: Plan §4 "finer kinds not adopted"; 09 Q24.

## Q16 [Domain] External origin of imported data is not captured, so provenance starts at the BFF

URL import is enabled via the BFF fetcher, and uploads come from scientists' machines and instruments. Lineage models these as an op with no inputs. An auditor asking "where did this file come from" gets "uploaded by X". Part 11 and ALCOA call for the origin (source URL, fetch time, response digest, server certificate, original filename, instrument id).
Example: a team imports a public reference genome from a URL; two years later the vendor changes the file at the same URL, and nobody can tell which version was imported or its original checksum.
Options: (a) imports record source URL, resolved address, HTTP status and headers, fetch time and SHA-256 as lineage origin attributes; (b) free-text origin note supplied by the user; (c) nothing beyond the audit event.
Recommendation: (a) for BFF-fetched imports, (b) for uploads with a controlled field set (instrument id, acquisition time).
Challenges: Spec user story 3; cross-cutting "URL import via BFF fetcher".

## Q17 [Domain] Lineage says what happened to a file but not how, for desktop and GUI-made changes

Lineage can say "edit" for a file changed in a Desktop Session or Workspace merge, but not which tool, version or parameters produced it. The user story promises reproduction ("so that I can reproduce it"). Only Jobs carry command, image and Pin; interactive edits carry none of that context.
Example: a figure was regenerated in a desktop RStudio session and committed. Lineage shows an `edit` of `fig3.png`; a regulator asks how it was produced and nobody can tell.
Options: (a) lineage nodes for interactive changes link the Desktop Session id and template version; (b) require analysis to run as Jobs for regulated outputs and mark interactive edits as `manual`; (c) accept.
Recommendation: (b) as policy in strict and (a) for traceability everywhere.
Challenges: Spec user story 1; 10 Q10.

## Q18 [Impl] Gap detection design: cost, definition of a gap and benign differences

Gap detection compares oxen commits with explicit ops and intent records. Many commits legitimately have no explicit lineage op: Workspace and Stage commits, Job auto-commits, merges, direct oxen pushes via the BFF. A full scan per repo is expensive and finding "unmatched commits" must exclude those classes without hiding real gaps.
Example: 1,000 repos with 50k commits each; a nightly scan calls oxen 50 million times or runs for days; it also flags 400 merge commits per week as gaps, so operators ignore the alert.
Options: (a) incremental scan from the last verified commit per branch, with commit-kind classification and an allowlist for system commits; (b) compare only audit Intent/Outcome events to lineage, not oxen; (c) on-demand per repo check.
Recommendation: (a) with (b) as the cheap continuous check, and a `capture` status per branch persisted in PostgreSQL.
Challenges: Spec "Gap detection compares oxen commits with explicit operations and intent records"; plan Phase 6 reconciliation.

## Q19 [Domain] What an auditor does with a gap is not defined, and strict claims there are none

Under strict the spec claims provenance is never missing, but gaps will still occur: direct oxen access by someone with infrastructure access, partial failures, and history that predates capture. A detected gap raises procedural questions: is it a deviation, who investigates, how is it closed, and how does closure appear in the record?
Example: the scan finds commit `e55a` without lineage. Nobody knows whether it was a legitimate push or a bypass; there is no workflow to assign, explain and close, so the gap remains permanently red.
Options: (a) a gap is an auditable record with states open, explained, accepted (signed by QA), with link to the deviation number; (b) automatic backfill with derived ops and no human step; (c) report only.
Recommendation: (a), and derived backfill (b) is allowed only as an evidence aid, never as closure.
Challenges: Spec user story 4; plan Phase 6 "reconciliation status".

## Q20 [Impl] Query contract: pagination, depth and fan-out are underspecified for graph reads

The query API returns a subgraph for a path or content hash with direction, depth, time bounds, limit and cursor. A cursor over operations does not give a stable graph page, depth expansion explodes for popular files (a reference file used by 10,000 Jobs), and results change during rebuild. Filters by kind, Job and commit are in the stories but the response shape and ordering are not.
Example: a request for descendants of `reference_genome.fa` with depth 3 returns 2.3 million ops; the UI times out and the cursor on page 2 skips ops inserted by a concurrent rebuild.
Options: (a) cursor on a stable (repo id, op sequence) order, hard caps on nodes and edges per response with a `truncated` flag, depth capped at 5; (b) server-side graph summarisation for hub nodes; (c) async export for large traversals.
Recommendation: (a) plus (c) for deep or hub queries.
Challenges: Plan §8 `cursor`, `depth`; spec user story 7.

## Q21 [Domain] Rebuild and supersede delete rows, which contradicts append-only provenance

An explicit op can supersede a derived one, and the plan prunes duplicate producers on rebuild; this deletes derived rows. The spec states corrections are additive and the original stays visible, yet the system itself removes derived records. For an auditor, a record that disappears is indistinguishable from tampering.
Example: an auditor exported the graph on 1 March showing a derived `move` edge; on 8 March a rebuild removed it because an explicit op arrived. The 1 March export now cannot be reproduced from the system.
Options: (a) mark superseded ops with `superseded_by` and hide by default, never delete; (b) delete derived ops but keep an audit event for each deletion; (c) as designed.
Recommendation: (a), and the query supports `as_of` time for reconstructing a historical graph.
Challenges: Spec user story 5 "original stays visible"; plan Phase 2 "prune duplicates on rebuild".

## Q22 [Domain] The operation vocabulary omits merge, restore, revert, branch and history-rewrite events

Kinds are upload, create, edit, move, copy, delete (the code also handles restore and rename). A merge brings file versions into a target branch; reverts and restores recreate older content; branches and tags capture states; metadata and schema changes affect records; repository deletion and force-push alter history. Auditors will ask about each of these as provenance events.
Example: a merge of `feature/cleanup` into `main` removes 300 files and changes 40; the lineage shows only the original per-file ops on the feature branch, and `main`'s state has no op explaining its arrival.
Options: (a) add `merge` and `revert` as op kinds with commit-level nodes and per-path edges for conflicts; (b) record at commit-level only (which commits and branches), not per path; (c) leave out and rely on the commit graph.
Recommendation: (b) for merge, tag and branch events and (a) for revert and restore; list unsupported events explicitly in the spec.
Challenges: Spec user stories 2 and 3; plan §5 kind list.

## Q23 [Impl] Migrating to stable repository ids from name-keyed lineage needs a defined backfill and name-reuse rule

Lineage is keyed by namespace and repo names. Switching to a stable repo id requires mapping every existing record, handling repos that were deleted and recreated under the same name, and namespace renames or transfers. A name that is reused by a new, unrelated repository would inherit the old repository's lineage if lookups still resolve by name.
Example: `lab/trials` was deleted in 2025 and a different team creates `lab/trials` in 2026; queries by name show 2025's lineage inside the new repo.
Options: (a) one-time backfill that assigns ids by creation time and detects name reuse, with a unique id column enforced and name only a lookup alias with validity period; (b) treat name reuse as forbidden for deleted repos; (c) manual mapping.
Recommendation: (a) plus (b) for repos with retained records.
Challenges: Cross-cutting "stable repository id"; spec user story 8.

## Q24 [Domain] "Included in or linked from the audit export" produces a mutable export, not inspection evidence

Lineage export is out of scope, but user story 9 wants lineage in or linked from the audit export. A link to a live API returns today's graph, and lineage can change after the export (Q21). Regulators and customers inspect on a snapshot: they expect a signed, complete, self-contained package that includes a manifest, verification data and the time of export.
Example: an inspection package refers to lineage by URL; two weeks after the inspection, the URL returns a different graph, and the company cannot prove what was shown.
Options: (a) export includes a lineage snapshot (NDJSON with manifest, hashes and the ledger state it was reconciled against); (b) export includes only a content hash of the lineage state and a retrieval query; (c) link only.
Recommendation: (a), and re-bring lineage export into scope.
Challenges: Spec Out of Scope "lineage export packaging" vs story 9.

## Q25 [Impl] The definition of "lineage cannot be stored" under strict leaves classification failures unspecified

Lineage ops have arity rules, and an operation that fails validation (for example, a copy through an unclassified route, a missing hash from oxen, an unusual body) is dropped with a log line. Under strict, treating validation failure as "cannot store" would refuse legitimate mutations; treating it as success reintroduces silent gaps. ADR 0001's rule (unknown write shapes are rejected) is about author injection, not lineage.
Example: a restore operation returns no content hash; arity validation fails; the upload either fails with 503 although oxen was fine, or succeeds without lineage.
Options: (a) split outcomes: store failure refuses the mutation, classification failure records an `unclassified` op with raw request and commit id; (b) block unclassified mutating routes entirely; (c) log only.
Recommendation: (a), and unclassified ops count as a gap category requiring closure (Q19).
Challenges: Spec "lineage writes fail closed under strict"; ADR 0001 classification rule.

## Q26 [Impl] Black-box HTTP tests cannot create the failure points that lineage correctness depends on

The test plan covers graph queries after mutations, strict-mode failure and rename survival through the BFF HTTP boundary. The critical behaviours are crashes between oxen's acknowledgement and the lineage write, concurrent writers, a partial rebuild, and a lineage store failure that leaves other stores healthy. None of these can be produced by HTTP requests alone against a normal container stack.
Example: the suite passes strict-failure tests by making the whole PostgreSQL container unavailable (everything returns 503), so the case where only the lineage insert fails is never exercised.
Options: (a) a fault-injection control surface in test builds (pause, fail next lineage write, kill after oxen ack), used only against test instances; (b) use container-level chaos (kill instances, block specific tables with a revoke) in a dedicated suite; (c) unit tests of the append function.
Recommendation: (b) plus (a), each with unique repo ids so tests remain parallel.
Challenges: Spec "Testing Decisions: single seam at the BFF HTTP boundary".

## Q27 [Domain] Lineage survives rename and transfer, but what does an auditor see about identity changes?

Story 8 says lineage survives rename and transfer. When a repo is renamed or transferred between namespaces and owners, the path-based identifiers in old records (namespace/repo) differ from today's name, ownership and access, and authorization decisions made at the time cannot be reconstructed from lineage alone.
Example: an auditor reading a 2025 op sees `lab/trials`; today the repository is `oncology/trial-17` owned by another team; nothing shows when or by whom the rename happened or that it is the same repo.
Options: (a) lineage displays repo id plus the name at the time of the operation and links rename and transfer events as graph nodes; (b) display only the current name; (c) keep old names in a note.
Recommendation: (a), with rename and transfer events themselves recorded as lineage events.
Challenges: Spec user story 8; cross-cutting rename decision.

## Q28 [Domain] Metadata and schema-bound records change file meaning without changing file versions

Metadata search and namespace-scoped schemas (12) let users attach structured metadata (sample id, subject, status) to files. Changing metadata can change the scientific meaning of a file (for example, marking a sample as excluded) without creating a new file version, so lineage, which tracks only file versions, shows no event.
Example: a sample is marked `excluded: true` in metadata on day 5; the file `results.csv` is unchanged, lineage is unchanged, and the exclusion influences a later Job's selection logic.
Options: (a) metadata revisions are lineage-linked events (node per revision, edge to the file version it annotates); (b) metadata audited only in the audit trail; (c) metadata excluded from lineage by design.
Recommendation: (a) for metadata keys flagged "affects interpretation", (b) otherwise.
Challenges: New gap; spec stories 1 and 2.

## Decisions log

| Q | Answer | Date |
| --- | --- | --- |
| Q1 | Intent-time stub; outputs completed at Outcome; reconciler | answered |
| Q2 | Commit diff emits per-path ops explicit_by_diff + commit node | answered |
| Q3 | Inferred edges distinct class, excluded from exports unless requested | answered |
| Q4 | Corrections need reason + different-Principal e-signed approval; chain shown | answered |
| Q5 | Inherited | answered |
| Q6 | Normalized op+version_ref tables, indexed, bounded traversal | answered |
| Q7 | Unique (repo,path,hash,commit) + precedence upsert; lock on rebuild | answered |
| Q8 | Inherited: SHA-256 | answered |
| Q9 | Cross-repo edges by repo id; restricted-node stub | answered |
| Q10 | Follows repo access; redaction process; no identifiers in names | answered |
| Q11 | Inherited: no hard delete | answered |
| Q12 | Op hash in immudb; lineage tables derived index | answered |
| Q13 | Inherited (00 Q5) | answered |
| Q14 | Reconcile from commit parent + conditional write 409 | answered |
| Q15 | Op node + edge table, paged; Jobs read I/O from lineage | answered |
| Q16 | Uploads: NONE (no origin fields); URL import disabled | answered |
| Q17 | Desktop Session link only | answered |
| Q18 | Incremental per-branch scan, classification, allowlist, capture status | answered |
| Q19 | Gap is auditable record open→explained→QA-signed | answered |
| Q20 | Stable cursor, caps+truncated flag, depth<=5, hub summary | answered |
| Q21 | Never delete: superseded_by, hidden default, as_of | answered |
| Q22 | Commit-level merge/tag/branch; revert/restore per-path; list unsupported | answered |
| Q23 | Inherited | answered |
| Q24 | NDJSON snapshot export w/ manifest, hashes, ledger state; in audit bundle | answered |
| Q25 | Store failure refuses; classification failure = unclassified gap op; unclassified routes blocked | answered |
| Q26 | Inherited: test-only fault hooks | answered |
| Q27 | Inherited | answered |
| Q28 | All metadata revisions in lineage | answered |

---

# Known Issues and Conflicts

## Conflicts with Other Specs

1. **Upload origin fields (Q16 vs 06 Q15, Q7)**: 11 records no upload origin fields while 06 captures client-asserted name/mtime and one lineage op per import. Reconcile where client-asserted metadata is stored. Owner: one owner per fact.

2. **E-signed corrections (Q4 vs 04 Q9, 00 Q9)**: E-signed correction approval must obey no self-signing and "authored by" vs "signed by" separation.

3. **Inferred edges in exports (Q3)**: Excluded from exports by default; auditors must explicitly request them.

4. **Op hash in immudb (Q12 vs 03)**: Adds write per op; covered by 03 latency budget (to be verified).

5. **Redaction process (Q10, 00 Q8)**: Cannot erase; legal sign-off on retention stance still needed.

## Open Risks and Blockers

6. **Restricted-node leakage (Q9)**: Cross-repo stub nodes may leak existence across repositories. Risk to review with 02.

7. **Stable repository IDs (Q21, 05 Q25)**: Lineage uses stable repository ids; static physical names keep commit ids unchanged.

8. **No unresolved blocker**: Q16 vs 06 mismatch is documentation alignment, not a gate.

## Unresolved Design Decisions

9. **XXH3 vs SHA-256 identity (Q8)**: Inherited SHA-256 decision; heuristics use SHA-256 when present.

10. **Cross-repo lineage scope (Q9)**: Cross-repo edges by stable repo id; shown as restricted-node stubs when viewer lacks read.

# Impact on Other Specs

## Dependencies on Other Specs

- **06 (Data Transfer)**: Q16 no origin fields conflicts with 06 Q15 client-asserted metadata
- **04 (Signatures)**: Q4 e-signed corrections obey no self-signing (04 Q9, 00 Q9)
- **00 (Cross-cutting)**: Q8 SHA-256 inherited; Q13 reconciler inherited (00 Q5); Q23 inherited (rename)
- **05 (Repositories)**: Q5 rename=copy+delete with stable id; Q21/Q23 stable repository IDs
- **08 (Workspaces)**: Q11 inherited lease management (08 Q4/Q11)
- **03 (Audit)**: Q12 op hash in immudb adds write per op; latency budget verification needed

## Impacts on Other Specs

- **09 (Jobs)**: Q15 op node + edge table, paged; Jobs read I/O from lineage (single writer)
- **11 (Lineage)**: Q28 all metadata revisions recorded in lineage
- **10 (Sessions)**: Q17 Desktop Session link only for attribution
- **02 (Authorization)**: Q10 lineage follows repository access; redaction process needed

## Cross-Cutting Concerns

- **Fail-closed strict mode**: Q1 Intent-time stub; outputs completed at Outcome; reconciler fills gaps
- **Multi-instance coordination**: Q7 unique constraint on (repo,path,hash,commit); lock on rebuild
- **Retention**: Q21 never delete; `superseded_by` hidden by default; `as_of` view
- **Tamper evidence**: Q12 op hash in immudb; lineage tables are derived index
- **Database design**: Q6 normalized op+version_ref tables, indexed, bounded traversal
- **Gap detection**: Q18 incremental per-branch scan, classification, allowlist, capture status

