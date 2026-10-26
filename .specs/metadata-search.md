Status: ready-for-agent

# 12 — Entity metadata, indexing and search (PLAT-META)

## Problem Statement

Users need governed, auditable metadata (tags, labels, typed fields) on every entity and fast, authorisation-scoped search across the platform.

## Solution

A generic entity-metadata model in PostgreSQL with inheritance, plus a derived search index that starts as PostgreSQL full-text search; a dedicated engine is added only after a measured failure (ADR). Search applies AuthZ scope before paging.

## User Stories

1. As a user, I want to tag a repository, directory or file, so that I can organise data.
2. As a user, I want metadata to inherit down namespace → repository → directory → file, so that I set it once.
3. As a user, I want the closest statement to win (add or remove), so that overrides are predictable.
4. As a user, I want to see provenance of inherited values, so that surprises are explainable.
5. As a namespace owner, I want namespace-scoped field schemas, so that teams define their own fields.
6. As an instance admin, I want instance-wide schemas as well.
7. As a user, I want full-text and facet search, so that I find data quickly.
8. As a user, I want search to only return what I may see, including counts and facets, so that nothing leaks.
9. As a user, I want file metadata attached to the path by default and pinned to a version on approve/release, so that released data is stable.
10. As an admin, I want sensitive fields redacted everywhere by default, so that secrets are protected.
11. As an auditor, I want all metadata mutations audited with diffs.
12. As an admin, I want a reindex that builds a new generation and swaps atomically, so that search stays available.
13. As an admin, I want a breaking field-schema change to grandfather existing records with a `needs_migration` flag.
14. As a user, I want to export search results as CSV, with masking.
15. As a user, I want metadata history, so that I see who changed what.

## Implementation Decisions

- Own records and history in PostgreSQL are authoritative; the search engine is derived and rebuildable online.
- Search starts on PostgreSQL full-text; OpenSearch or Meilisearch only if the prototype misses the relevance set or load target (new ADR). AuthZ scope is applied before paging.
- Schemas are namespace-scoped from the start, with an instance-wide tier.
- File metadata unpinned by default; pin on approve/release.
- `sensitive` values are never indexed and never written to audit; masked at read; encryption only if later required.
- Index keys use stable repository ids; physical oxen names are static.
- User and group metadata is removed from the first release.
- Export is asynchronous with reason, filter snapshot, manifest digest, cap and expiry; audit detail records filters, count and `masked`.
- Index updates flow through the Postgres outbox with revision-guarded idempotent upserts (access changes: see Conflicts and open risks).
- Tag inheritance: latest statement closest to the entity wins.
- Multi-instance index consistency through generations.

## Testing Decisions

- HTTP tests per entity type for scope-before-paging, inheritance, provenance, redaction, reindex.
- Prior art: existing metadata API tests.

## Out of Scope

Encryption at rest of sensitive values, real-time cross-node replication beyond the shared engine.

## Further Notes

Fan-out on namespace edits needs async batching and an impact preview.

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Search and authorisation
- Allowed-set filter by stable repo id plus namespace shortcut; hits rechecked authoritatively; benchmark at 40k repos (Q1).
- Facets computed engine-side under the scope filter with a bucket cap; hidden-tag conformance test (Q3).
- Filter, sort and facet on sensitive fields blocked without view right; attempts audited (Q14).
- Access changes update the index synchronously; failure mode must be fail closed with recheck (Q2).
- Prototype Postgres full-text first; engine only on failure, with ADR (Q26).
- 50-query relevance set; identifier fields as keywords (Q23).
- Point-in-time paging with search-after, hard cap, 1M-document load test (Q24).
- Watermark-wait parameter for read-your-writes; two-instance swap test (Q28).

Index lifecycle
- Outbox, revision-guarded idempotent upserts, drift detector (Q4).
- Reindex: snapshot plus outbox replay, DB lease, pointer swap, count verification (Q5).
- Sparse index with non-exhaustive banner; audited async effective-metadata report (Q6).
- Rate-limited background indexer on default branches with visible state (Q25).
- Defer Session and Stage metadata; Jobs indexed sparsely (Q27).

Inheritance, fan-out and revisions
- Namespace edit: advisory impact preview, actual count recorded, "updating" state, query-time resolution namespace→repo (Q7).
- Effective-metadata snapshot at every merge, immutable, with signer identity (Q8).
- Metadata revision recorded in Pin and Job lineage; committed snapshot opt-in (Q9).
- Head capture only for pin/snapshot; one per bulk operation; Intent event kept; documented exception (Q10).
- Bulk: one Intent and Outcome per request with per-ref results, cap, all-or-nothing per repo (Q11).
- Per-entity revisions plus chain token for locked/regulated fields (Q21).

Sensitive data, schemas, identity
- Sensitive never in audit: keyed hash plus changed marker (Q12).
- Never indexed; masked at read; all-surface contract test (Q13).
- Reserved instance keys; other keys auto-qualified (Q15).
- Breaking schema change: dry-run, second approver, migration queue with deadline (Q16).
- Stable repo-id prefix; names resolved at display; aliases (Q17).
- User/group metadata removed from first release (Q19).
- Tombstones kept; values stripped after owner period for non-regulated data; documented exception (Q20).
- Export: async, reason, filter snapshot, manifest digest, cap, expiry (Q22).

## Conflicts and open risks

- Q2: synchronous index update on access change contrasts with the outbox (Q4) and the one-owner-per-fact rule; failure mode must be defined (fail closed, recheck) and a sync write into a derived index risks Main-database/index dual-write inconsistency.
- Q10: head capture and skipped per-item Intent is a documented exception to Intent-before-mutation; needs ADR-level sign-off from 03/04.
- Q20: stripping values after the owner period conflicts with no-hard-delete unless tombstones and audit are kept; documented exception.
- Q6: sparse index means search is non-exhaustive by design; users must see the banner.
- Q26/Q24: engine choice is conditional on measured results; 1M target unproven.
- Q19 removes user/group metadata; any module referencing it (e.g. admin views) must not assume it.
- Q17/Q18 depend on stable repo ids and static oxen names (inherited global decisions); 16 Q24 wipes the pilot so no migration is needed.

---

# Open Questions


Status: spec is ready-for-agent, but it rests on a search engine not yet chosen, a `sensitive` flag that is not enforced anywhere today, and a search path that currently scans every candidate entity in memory and calls the authorization check per entity.
Biggest risks: authorization leaks through a derived index (stale scope, facets, counts, ranking), immutable audit and "retain forever" colliding with redaction and erasure, and a lazy/sparse file model that makes GxP inventory searches silently incomplete.

## Q1 [Impl] How is AuthZ scope expressed to the search engine once a user can read 40,000 repositories?
The spec says scope is applied before paging, which today means an in-process loop that asks the authorization module about each candidate. A dedicated engine needs the scope as a filter it can evaluate itself. A large allow-list of repositories per query is slow or capped by the engine, while a per-document "who can read" field goes stale on every access change. Group membership, custom roles and namespace-level grants make either representation expensive.
Example scenario: Instance admin Dana reads everything; scientist Ravi is a member of 12 groups that grant 3,000 repositories across 40 namespaces. A search for "tag:gxp" must filter to exactly Ravi's set, and a role edit at 10:02 must change his results by 10:03.
Options:
- Send the allowed namespace/repository id list as a filter on each query — exact and always current, but breaks on large sets.
- Index ACL principals per document (groups, users) — fast queries, but every grant change reindexes subtrees.
- Query the engine for candidates, then post-verify against AuthZ and over-fetch — simple, but violates scope-before-paging and breaks counts.
Recommendation: Allowed-set filter by stable repository id with a namespace-level shortcut, plus a final authoritative recheck on returned hits; benchmark at 40k repositories before choosing the engine.
Challenges: "Search applies AuthZ scope before paging" and "OpenSearch or Meilisearch, choice during implementation" — the engine choice decides whether the rule is implementable.

## Q2 [Domain] What is the acceptable staleness window for a revoked user still seeing metadata in search?
The index is derived and eventually consistent, yet the owner stated that users must never see what they cannot read. A revocation, a repository going private or an offboarding takes effect in AuthZ immediately but reaches the index later, or never if the sync fails. Auditors will ask for the maximum exposure time and for evidence it holds. Cached search pages and exported CSVs extend the window further.
Example scenario: Contractor Lee is removed from namespace "oncology-trial-7" at 09:00. The index consumer is backlogged by 4 minutes; at 09:02 Lee searches "patient cohort" and sees repository names and tags from the trial.
Options:
- Mandatory per-hit AuthZ recheck at read time — closes the leak, costs latency and breaks counts slightly.
- Synchronous index update on access change — tight window, couples AuthZ writes to the engine's availability.
- Documented bounded staleness (for example 30 s) with a recheck only for restricted namespaces — cheaper, but an explicit risk acceptance.
Recommendation: Recheck every returned hit and drop mismatches, compute counts from the filtered allowed set, and document the residual window for facet counts only.
Challenges: "Search applies AuthZ scope before paging" and "search to only return what I may see, including counts and facets".

## Q3 [Impl] How are facet counts and totals kept exact and leak-free?
Plan text promises counts and facets computed only over the allowed set. Some engines return approximate distributions, cap facet buckets, or compute counts before the filter if the filter is applied as a post step. Free tags and labels also reveal existence: a tag value that appears once is a pointer to a hidden entity's name.
Example scenario: A user searches "type:file" and the facet panel shows tag "project-orion-acquisition: 1" although the only entity carrying it is in a namespace they cannot read.
Options:
- Compute facets in the engine strictly under the scope filter — correct if the engine supports it, bucket limits apply.
- Compute facets in the BFF from the filtered hit set — exact, but unbounded work.
- Show facets only after a minimum bucket size (k-anonymity) — hides small leaks, confuses users.
Recommendation: Engine-side facets under the same filter as hits, a cap on bucket counts, and a conformance test seeding a hidden unique tag per engine candidate.
Challenges: User story 8 and "Result counts and facets are computed over the allowed set only".

## Q4 [Impl] How does a PostgreSQL write reliably reach the engine without dual-write drift?
Own records and history are authoritative in the Main database, while the engine is derived. A direct engine call after the commit fails silently on a crash; a call before the commit indexes data that was rolled back. With N BFF instances, several writers race and can apply index updates out of order.
Example scenario: Instance A updates the "status" field on a repository to "approved" (revision 7) and instance B sets it to "rejected" (revision 8). B's engine write lands first and A's overwrites it; search says approved, the record says rejected.
Options:
- Transactional outbox in PostgreSQL consumed by an indexer with revision-based upserts — durable, adds a worker.
- Change-data-capture from the database log — no app code, heavy infrastructure.
- Synchronous dual-write with a repair sweep — simple, and the repair sweep becomes the real mechanism.
Recommendation: Outbox plus idempotent revision-guarded upserts, with a drift detector comparing counts and revision maxima per namespace.
Challenges: "Multi-instance index consistency through generations" — generations solve rebuilds, not steady-state ordering.

## Q5 [Impl] What is the online reindex contract when two BFF instances write during a rebuild?
The spec wants a new generation built and swapped atomically while search stays available. Writes arriving during the build must land in both generations or be replayed afterwards, and the swap must be visible to all instances at once. A crash in the middle leaves a half-built generation and a lock nobody holds.
Example scenario: Admin Priya starts a reindex of 400,000 records at 14:00 taking 25 minutes. During that time 1,900 metadata edits happen on both instances. After the swap, 37 edits made in the last second of the build are missing from the new generation.
Options:
- Dual-write to old and new generation until swap, then drain the outbox — correct, more moving parts.
- Build from a snapshot revision and replay the outbox after it — simpler, needs ordered revisions.
- Take writes to a read-only mode during swap — easy but a visible outage and conflicts with fail-closed expectations.
Recommendation: Snapshot-plus-outbox-replay with a database-held lease for the rebuild owner, an alias or pointer swapped in PostgreSQL, and a post-swap verification count.
Challenges: User story 12 and "reindex builds a new generation and swaps atomically".

## Q6 [Domain] Are GxP inventory searches acceptable if inheriting files are not individually indexed?
Plan design materialises files and directories sparsely: only files with their own metadata have rows; others inherit lazily. A search for "tag:gxp type:file" therefore returns only annotated files plus an "applies to all files under" hint. A regulated user asked to list every GxP-classified file will receive an incomplete list that looks complete.
Example scenario: Namespace "acme" is tagged "gxp"; 2.4 million image files in a repository inherit it. An auditor searching "gxp files" sees 120 annotated hits and concludes only 120 files are in scope.
Options:
- Keep sparse rows and label results as non-exhaustive with an on-demand expansion — cheap, relies on the reader noticing.
- Materialise all files for regulated namespaces — exhaustive, enormous fan-out and cost.
- Offer a separate "effective metadata report" for a repository at a commit, generated asynchronously — exhaustive for audits without bloating the index.
Recommendation: Sparse index for everyday search, explicit non-exhaustive banner, and an audited report job for completeness at a given commit.
Challenges: Plan section 5.2 sparse materialisation, and user story 2.

## Q7 [Impl] How is fan-out on namespace edits bounded, and what does the impact preview guarantee?
A tag on a namespace changes the effective metadata of every repository, job and annotated file below it. The plan proposes async batching, a pending marker and an impact preview, but between preview and save the descendants change, and during the batch window search shows a mixture of old and new values.
Example scenario: Owner Tomas previews "affects 42 repositories, 17 override" and saves 20 minutes later; two repositories were created meanwhile. The batch of 100k descendant rows takes 6 minutes, during which half of them are searchable by the new tag and half not.
Options:
- Version the preview and reject save if the affected set changed beyond a delta — safe, annoying.
- Treat the preview as advisory and report final counts in the audit event — simple, no guarantee.
- Resolve inherited metadata at query time for repository level and above — no fan-out, slower search.
Recommendation: Advisory preview with the actual affected count recorded after completion, a visible "updating" state per entity, and query-time resolution for the namespace-to-repository levels.
Challenges: "Fan-out on namespace edits needs async batching and an impact preview" in Further Notes.

## Q8 [Domain] What does "pin on approve/release" mean when the review gate is merge by a maintainer?
File metadata is unpinned by default and pinned to a version "on approve/release". The owner has decided that Merge plus maintain is the review gate and that the maintain user's signature happens at merge. It is undefined whether merging snapshots the effective metadata at that commit, who triggers it, and what happens to metadata edited after the release.
Example scenario: Maintainer Ines merges the "batch-2026-03" branch and signs. Two days later a colleague changes the "assay_type" field on the same path from "ELISA" to "qPCR" in the unpinned record. The released commit is later audited and shows "qPCR".
Options:
- Auto-snapshot effective metadata into immutable pinned records at every merge — evidence is stable, doubles storage.
- Pin only for namespaces flagged as regulated — focused, depends on correct flagging.
- Keep unpinned and rely on history by timestamp — cheap, forces auditors to reconstruct.
Recommendation: Snapshot-on-merge for regulated namespaces, including provenance and the signer's identity, and make pinned records read-only.
Challenges: User story 9 and "pin on approve/release", which names a gate the platform does not have as a distinct step.

## Q9 [Domain] Is metadata that lives outside the Oxen commit history valid evidence for a dataset version?
The plan rejects committing metadata (decision D3) so there is no commit noise. But a dataset commit with its metadata only in the Main database cannot be reproduced from the repository alone, and a Job pinned to a commit does not pin the metadata that described it. Under Part 11 and ALCOA+ the "original" and "contemporaneous" qualities require the context to be recoverable for that version.
Example scenario: A Job ran against commit 9f2c with metadata "unit=mg/mL". A year later the repository is cloned to another site; the unit field is absent and the analysis reads as dimensionless.
Options:
- Optional exported snapshot committed by the BFF at release — versioned with data, creates commits and author-injection questions.
- Job pins reference a metadata revision number as well — cheap, keeps the database authoritative.
- Accept the gap and document it — honest, weak in audits.
Recommendation: Record the metadata revision in the Pin and in the Job's lineage; make the committed snapshot an opt-in for regulated repositories.
Challenges: Decision D3 and the Phase 4 optional snapshot.

## Q10 [Impl] Does a metadata mutation really need the extra oxen read and lock under strict mode?
The cross-cutting rule is a dataset head read and lock before and after every mutation class. Metadata edits never touch oxen, yet a rule applied literally will add two oxen round trips and a lock to a tag edit, and a bulk operation of 2,000 entities multiplies that. Fail-closed also means an immudb outage blocks tagging entirely.
Example scenario: A scientist bulk-tags 800 files before a deadline; the BFF performs 1,600 oxen reads under locks, the tag job takes 11 minutes, and a concurrent merge on the same repository waits on the lock.
Options:
- Exempt metadata-only mutations from dataset head capture but keep the Intent event — fast, a documented exception to the "every class" rule.
- Capture the head once per request rather than per entity — balanced, still locks.
- Keep the rule uniform — consistent in validation documents, costly.
Recommendation: Capture head only where the mutation depends on the dataset (pin and snapshot), one capture per bulk request, and record the exception in the validation documents.
Challenges: Cross-cutting dataset-head decision applied to "all metadata mutations audited with diffs".

## Q11 [Impl] How many Intent events does a bulk metadata edit produce and what is the atomicity story?
Plan and spec say a parent edit is one audit event with an affected count, but bulk edits over many references report partial failure. Under strict mode each mutation needs an Intent event; one per reference may flood immudb, while one for the whole request hides which references succeeded.
Example scenario: A bulk apply of label "reviewed=true" to 5,000 references: 4,950 succeed and 50 fail on revision conflicts. The audit shows one Outcome event "partial" without the list of 50.
Options:
- One Intent per request with a per-reference result list in the Outcome event — compact, large payloads.
- One Intent per reference — complete, 5,000 immudb writes and slower.
- All-or-nothing bulk transactions — simple semantics, frustrating for users.
Recommendation: One Intent and Outcome per request carrying an explicit per-reference result list, with a cap on request size and all-or-nothing semantics inside each repository.
Challenges: User story 11 and the bulk endpoint with partial-failure report.

## Q12 [Domain] How do immutable audit diffs coexist with the redaction of sensitive fields?
Redaction is decided as the control for sensitive fields, and audit diffs record old and new values for GxP-relevant fields. immudb is append-only and records are retained forever by decision. If a sensitive value is ever written into an audit diff, it can never be removed, and any later erasure or privacy request has no answer.
Example scenario: A user puts a patient identifier in a field flagged sensitive; the Intent event stores "old: empty, new: PT-48213". Two years later a data-protection officer asks for erasure and the audit entry cannot be changed.
Options:
- Never write sensitive values into audit; store a hash or "changed" marker — safe, loses the old/new evidence for those fields.
- Store values encrypted with a per-field key that can be destroyed (crypto-shredding) — meets erasure, adds key management.
- Accept plaintext in audit and restrict audit read access — simple, indefensible for personal data.
Recommendation: Redact in audit by default with a keyed hash so equality can be proven, and decide encryption only when a concrete regulatory need appears.
Challenges: "sensitive redacts everywhere; encryption only if later required" against "retention forever".

## Q13 [Impl] What actually enforces sensitive today, and where do values still travel?
The sensitive flag is a definition attribute only; no code enforces it. Values would pass through the Main database, history, the engine documents, highlight snippets, CSV export, logs and error messages, and each is a separate redaction site. "Redacts everywhere" is a promise across at least eight surfaces with no single enforcement point.
Example scenario: A field "contact_email" is flagged sensitive; a search for "gmail" still ranks the entity top because the engine indexed the value, and the highlighted snippet shows it.
Options:
- Exclude sensitive fields from the engine entirely and from history diffs, store only in the primary record — one decision, loses searchability of these fields.
- Index and mask at response time — searchable, ranks reveal values.
- Reject sensitive typed values altogether (store references) — strongest, restrictive.
Recommendation: Never index sensitive values, mask at read, and add a contract test enumerating every surface for a seeded sensitive value.
Challenges: Plan Q7 "redact vs encrypt" and user story 10; code reality (no enforcement).

## Q14 [Domain] Can a user infer a sensitive value through filters, sorting or counts?
Even when displayed values are masked, a filter on a sensitive field returns different result sets, and facet counts reveal distribution. A user who can edit but not view sensitive fields could binary-search a value.
Example scenario: A user without the sensitive-view permission runs "field.salary_band>=80" then ">=90" and finds which employee entities match.
Options:
- Disallow filter, sort and facet on sensitive fields for users without permission — closes the oracle, small feature loss.
- Allow with minimum result thresholds — partial.
- Allow for all; rely on field choice — leaks.
Recommendation: Block all query operators on sensitive fields without the view permission and audit attempts.
Challenges: "Search ... counts and facets ... nothing leaks" and the redaction decision.

## Q15 [Domain] Can a namespace owner define a field that undermines an instance-wide GxP schema?
Schemas are namespace-scoped from the start, with an instance-wide tier. If two tiers define the same key, search facets across namespaces merge or split unpredictably, and a namespace owner can define "gxp_class" with permissive values that look like the instance field to an inspector.
Example scenario: The instance defines gxp_class as enum {GLP, GMP, GCP}; namespace "research" defines its own gxp_class as free text with "n/a". A cross-namespace facet shows both and counts 600 "n/a" entities as classified.
Options:
- Reserve instance keys; namespaces may not redefine them — clear, restricts autonomy.
- Namespace-qualified keys everywhere — explicit, noisy UI.
- Allow shadowing with a visible "overrides instance" badge — flexible, risky.
Recommendation: Reserved instance keys plus automatic namespace qualification of all other fields in cross-namespace views.
Challenges: "Namespace-scoped metadata schemas from start" and the Phase 3 locks idea.

## Q16 [Domain] Who approves a breaking field-schema change, and does grandfathering stay validated?
The decision is grandfather existing records with a needs_migration flag and block only new writes. Records that violate the new schema stay visible and searchable, so the platform holds both compliant and non-compliant data indefinitely. The change itself is a controlled change in a validated system but has no approval step.
Example scenario: A namespace owner turns "batch_id" from free text to an enum of 12 values on Monday. 18,000 records now violate it; none are blocked, search facets show 40 old values, and an inspector sees an uncontrolled vocabulary.
Options:
- Require a second approver and a dry-run report before breaking changes — controlled, slower.
- Allow the owner alone but audit it with the impact count — fast, weaker control.
- Forbid breaking changes; require a new field and deprecate the old — strictest, clumsy.
Recommendation: Dry-run mandatory, second approver for regulated namespaces, and a migration queue with a deadline surfaced in the owner's notifications.
Challenges: User story 13 and Q10 resolution "grandfather with needs_migration".

## Q17 [Impl] The entity reference grammar is name-based, so how does it fit the stable repository id?
Cross-cutting says authorization, favorites, metadata, lineage and audit use a stable repository id. The metadata plan keys entities by names: repository by namespace/repo, branch by name, file by path, with only a note about migration hooks. Names inside the reference are also denormalised on every record for scoping.
Example scenario: Repository "acme/data" gets id r_81f. Metadata keyed on "acme/data:img/a.png" must change keys on rename, while the history entries and audit events still carry the old name.
Options:
- Rekey on stable id plus path and keep a name-to-id map for display — correct, migration work on every type.
- Keep names and rewrite on rename — simple, breaks history linking.
- Use opaque ids for everything — consistent, loses readable refs in URLs.
Recommendation: Stable repository id as the prefix of every reference, names resolved at display, and old names kept as aliases in history.
Challenges: Plan section 4.1 entity reference table versus cross-cutting "Repository identity".

## Q18 [Domain] After a copy-plus-delete rename, which metadata, pins and commit ids survive?
Renames are decided as copy and delete on oxen at the BFF with a stable id. If the copied repository has new commit hashes or lacks branches, pinned file metadata and snapshot-on-release records point at commits that no longer exist under the new name. The record was released under the old identity.
Example scenario: Repository "trials/alpha" is renamed to "trials/alpha-v2" and 14 released commits carry pinned metadata. Oxen's copy yields identical commit ids or not; if not, 14 pins dangle and an auditor cannot match the released evidence.
Options:
- Verify commit ids are preserved by the copy and fail the rename if not — safe, may make rename unusable.
- Keep a commit-id mapping table and rewrite pins — works for any copy, adds a lineage dependency.
- Forbid renames for repositories with pinned or released metadata — conservative.
Recommendation: Spike whether the copy preserves commit ids, block renames of repositories with released pins until a mapping table exists, and audit the mapping.
Challenges: Cross-cutting rename decision and "Lifecycle hooks (rename, delete cascade)".

## Q19 [Domain] Should user and group metadata be visible to admins and self, and who may write it?
The retained proposal is visibility to admins and the user. User metadata about a person (team, location, qualification status) is personal data in a long-retained table, and self-edit would let a user assert qualifications such as "gmp_trained=true" that others rely on. Group names from the IdP can also change or collide across IdPs.
Example scenario: Scientist Ana sets her own field "training_gmp=current" and a repository's reviewer filter uses that field; no one validated it.
Options:
- User metadata only writable by admins, readable by self — controlled, an admin task.
- Self-writable but marked unverified in search and UI — flexible, easy to misuse.
- Drop user and group entity types from scope — reduces risk, loses a requirement.
Recommendation: Remove user and group metadata from the first release, or admin-only write with self-read and retention tied to the identity lifecycle.
Challenges: Decision "User and group metadata visibility: admins and self (proposal retained)" and plan Q2.

## Q20 [Domain] What happens to tombstoned metadata of deleted entities given retention forever?
Deleted entities leave tombstoned metadata retained for audit and hidden from search; hard purge is admin-only. With retention forever, tombstones accumulate and include names, tags and potentially personal data, with no policy for expiry. A repository recreated under the same name can inherit confusion.
Example scenario: A repository holding mislabeled donor data is deleted after a privacy complaint; its metadata, including donor labels, remains in the Main database, history and audit for ever.
Options:
- Retain tombstones and restrict reads to auditors — meets traceability, retains personal data.
- Purge tombstone payloads after a defined period while keeping audit references — balances, conflicts with "forever".
- Cascade hard-delete with an approval workflow — complete, destroys evidence.
Recommendation: Keep tombstones, strip values after an owner-defined period for non-regulated namespaces, and document the exception to retain-forever.
Challenges: Decision D6 and cross-cutting "Retention forever".

## Q21 [Impl] How do optimistic concurrency and inheritance interact under concurrent edits?
Revision checks are per entity, but an effective value depends on ancestors. Two users can edit a parent and child concurrently, each with a valid revision, producing an effective result neither expected. The preview shown before save may also be stale.
Example scenario: Owner A removes tag "legacy" at namespace level while owner B adds it at repository level with correct revisions. Final effective state depends on the order and no conflict is reported.
Options:
- Keep per-entity revisions and accept ordering semantics, documenting "closest wins" — simple, matches plan.
- Include an ancestor-chain revision token in writes — detects conflicts, adds friction.
- Serialise edits per namespace — safe, throttles busy namespaces.
Recommendation: Per-entity revisions plus the chain token only for lock-protected and regulated fields.
Challenges: Plan decision D5 and the "latest statement closest to the entity wins" rule.

## Q22 [Domain] How are CSV exports governed as data leaving the platform?
Masked export records filters, row count and a masked flag in audit. Exports leave the system with no further control and scientists tend to share them. Row-level scope, masked fields, an export size limit and formula-injection guards all matter, and an unmasked export for authorised users is a data-exfiltration channel.
Example scenario: A user exports 250,000 rows with labels and descriptions to a spreadsheet and e-mails it to a partner; the audit shows only "count 250000, masked false".
Options:
- Require a reason and cap size; store the manifest hash in audit — traceable, friction.
- Disallow unmasked export except for admins — strict, limits legitimate use.
- Make export asynchronous, produced as a file with expiry — controls load, adds storage.
Recommendation: Asynchronous export with a mandatory reason, the filter snapshot, a manifest digest in the audit event and a size cap.
Challenges: User story 14 and "Masked export: audit detail records filters, count and masked".

## Q23 [Domain] Will the search actually find what scientists look for (identifiers, units, mixed languages)?
Scientists search by compound codes, sample ids, gene names, units and partial tokens, not natural language. Default analyzers split "AB-1234/7" or "5 mg/mL" and rank poorly; both candidate engines differ in typo tolerance and tokenisation. Search relevance requirements have not been stated and cannot be validated without examples.
Example scenario: A scientist searches "BRCA1-KO-12" and gets 3,000 results for "BRCA1" while the exact entity is on page 40.
Options:
- Define a relevance test set of real queries and gate engine choice on it — evidence-based, work upfront.
- Add exact-identifier fields with keyword analyzers — targeted, per-field schema work.
- Accept defaults and iterate — fast, user frustration.
Recommendation: Build a 50-query relevance set with the owner before the engine ADR and require identifier fields to be keyword-analysed.
Challenges: User story 7 and "OpenSearch or Meilisearch, choice during implementation".

## Q24 [Impl] What scale numbers does the 200 ms goal assume, and what does the current code do at that scale?
The plan targets under 200 ms at about 100,000 entities. The existing search resolves effective metadata for each candidate in the request path, builds facets by iterating all hits and paginates through a cursor found by position in the ranked list. This is linear per query and the cursor breaks when ranking shifts between pages.
Example scenario: With 400,000 entities and a query matching 120,000, a request touches all of them; page 2 uses the last hit's key and, if a metadata edit between page requests changes ranking, entries repeat or vanish.
Options:
- Engine-native cursors (search-after) with a pinned point-in-time — stable, engine-specific.
- Offset paging with a cap (for example 1,000 results) — simple, no deep browsing.
- Snapshot the result set server-side per query session — stable, uses memory.
Recommendation: Point-in-time or search-after pagination, a hard result cap, and a stated target of 1M entities with a load test at that size.
Challenges: Plan goal 2 and the current in-memory search behaviour.

## Q25 [Impl] How do Oxen-derived metadata and tabular schema metadata get into the index?
Plan wants system fields such as type, size and tabular columns indexed read-only, with a refresh hook on commit. Commits reach oxen through the BFF proxy, but pushes may also land through paths with different handlers, and the commit hook needs a scan of the tree. Tabular schema metadata is only versioned with workspace commits.
Example scenario: A 30 GB repository receives 5,000 files in one commit; the index hook fetches metadata for each file, taking 40 minutes and hammering oxen-server.
Options:
- Index on demand for the latest commit of default branches only — bounded, incomplete for history.
- Background indexer with rate limits and a per-repository budget — fair, eventually consistent.
- Drop derived oxen fields from scope — simple, loses "tabular files with column age".
Recommendation: Rate-limited background indexer for default branches, with a visible indexing state per repository and a documented staleness.
Challenges: Plan section 2.1 implications and Phase 3 "dataframe/column mirror".

## Q26 [Impl] What operational and validation burden does a new stateful engine bring?
The decision adds OpenSearch or Meilisearch to the existing PostgreSQL, immudb, MongoDB and Redis. It needs authentication between BFF and engine, TLS, version pinning, upgrade and mapping migration procedures, and sizing, while the deployment target and backups are undecided. In a GxP context the engine is part of the validated system even though derived.
Example scenario: An engine minor upgrade changes tokenisation; relevance and counts change silently, and the validation team has no re-qualification protocol.
Options:
- Choose the engine with the smaller footprint and document upgrades as controlled changes — pragmatic.
- Use PostgreSQL full text and trigram until measured need — fewer systems, may not reach scale.
- Run the engine as a managed service — less operation, more vendor dependency.
Recommendation: Prototype PostgreSQL full-text first against the 1M target; adopt the engine only if the measured results fail, and write the ADR with upgrade procedure.
Challenges: Cross-cutting "dedicated search engine as derived index" decision.

## Q27 [Domain] Is metadata on ephemeral entities (Jobs, Desktop Sessions, Stages) worth indexing forever?
Metadata can attach to jobs, sessions and workspaces, which are numerous and short-lived, while retention is forever. Every job and desktop session becomes a permanent index row and tombstone, and these entities inherit from a repository or a user in different ways.
Example scenario: A nightly pipeline creates 500 jobs a day; in two years that is 365,000 indexed entities carrying inherited tags from the repository, yet nobody searches them.
Options:
- Allow metadata only on durable entities (namespace, repository, directory, file, commit) at first — focused, lowers scope.
- Allow on jobs but index only when explicitly tagged — bounded.
- Keep all types — maximum generality, maximum cost.
Recommendation: Defer Desktop Session and Stage metadata, allow Job metadata with sparse indexing.
Challenges: Plan entity table covering every entity type and user story 1.

## Q28 [Impl] How can BFF-boundary tests cope with an eventually consistent engine and N instances?
Tests drive HTTP only and run against real containers, but search results appear after asynchronous indexing, and two BFF instances create ordering and cache differences. Polling with sleeps makes tests slow and flaky; unique ids must isolate parallel tests in a shared engine, and cleanup of derived documents is hard.
Example scenario: A test sets a tag on instance A and searches on instance B 100 ms later; it passes locally and fails in CI at random.
Options:
- Expose a read-your-write search parameter that waits for index watermark — deterministic, a product feature used by tests.
- Test-only polling helper with timeout — simple, flaky risks.
- Make search synchronous after write — strongest, couples availability.
Recommendation: Provide a watermark-wait on the search API usable by CLI and tests, and add a two-instance test of generation swap.
Challenges: Cross-cutting testing decision and plan test strategy.

## Decisions log

| Q | Answer | Date |
| --- | --- | --- |
| Q1 | Allowed-set filter by stable repo id + namespace shortcut; authoritative recheck of hits; benchmark 40k repos | answered |
| Q2 | Synchronous index update on access change (owner choice; contrasts with outbox—define failure mode: fail closed/recheck) | answered |
| Q3 | Engine-side facets under scope filter, bucket cap, hidden-tag conformance test | answered |
| Q4 | Postgres outbox + revision-guarded idempotent upserts + drift detector | answered |
| Q5 | Snapshot + outbox replay, DB lease, pointer swap, count verification | answered |
| Q6 | Sparse index + non-exhaustive banner + audited async effective-metadata report | answered |
| Q7 | Advisory preview, actual count recorded, updating state, query-time resolution ns→repo | answered |
| Q8 | Snapshot effective metadata at every merge, immutable, signer identity | answered |
| Q9 | Metadata revision in Pin and Job lineage; committed snapshot opt-in | answered |
| Q10 | Head capture only for pin/snapshot; one per bulk; Intent kept; documented exception | answered |
| Q11 | One Intent+Outcome per request w/ per-ref results, cap, all-or-nothing per repo | answered |
| Q12 | Sensitive never in audit: keyed hash + changed marker | answered |
| Q13 | Never index sensitive; mask at read; all-surface contract test | answered |
| Q14 | Block filter/sort/facet on sensitive w/o view; audit attempts | answered |
| Q15 | Reserved instance keys; auto-qualify others | answered |
| Q16 | Dry-run + second approver + migration queue with deadline | answered |
| Q17 | Stable repo id prefix; names at display; aliases | answered |
| Q18 | Inherited: static repo names, commit ids never change | answered |
| Q19 | Remove user/group metadata from first release | answered |
| Q20 | Keep tombstones; strip values after owner period for non-regulated; documented exception | answered |
| Q21 | Per-entity revisions + chain token for locked/regulated fields | answered |
| Q22 | Async export, reason, filter snapshot, manifest digest, cap, expiry | answered |
| Q23 | 50-query relevance set; keyword identifier fields | answered |
| Q24 | PIT/search-after, hard cap, 1M target load test | answered |
| Q25 | Rate-limited background indexer default branches, visible state | answered |
| Q26 | Prototype Postgres FTS first; engine only if it fails; ADR | answered |
| Q27 | Defer Session/Stage metadata; Job sparse indexing | answered |
| Q28 | Watermark-wait param + two-instance swap test | answered |

---

# Known Issues and Conflicts

_To be documented: Known blockers, conflicts with other specs, and unresolved design questions._

# Impact on Other Specs

_To be documented: Dependencies, blocking relationships, and cross-cutting concerns._

