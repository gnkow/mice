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
- Imports land on a non-validated branch; the completing call (small-file direct commit, chunked upload, zip import, URL import) can never commit to a validated branch, including the default branch. Reaching it needs a merge request with a signed merge by an `approver` who is not an author in the range (04, 05). The CLI can open the merge request; signing is browser-only.
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

## Alignment with 04 (2026-11-05)

- Imports (06) are not signed; they land on a non-validated branch. The signature is the signed merge into a validated branch by an `approver` who is not an author in the range.
- Superseded: Q1 "Merge+maintain gate" and "needs a merger other than the uploader (02 Q1)" (now: any approver not in the range's authors; one suffices; no two-mergers rule).
- Q4 manifest-in-Outcome (digest) remains; the signed-merge manifest digest (04) is separate and binds the merge result.

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
- Q1 requires imports through branch plus signed merge (05, 04); one approver other than an author in the range suffices (no two-mergers rule).
- Q25: per-push and clone manifests add load; derived data must be reconcilable via the Postgres outbox.

---

# Open Questions


Status: spec is ready-for-agent but rests on unverified assumptions (oxen chunk state, quota owner, fetcher placement), and several answers conflict with the review-gate and strict-mode decisions made elsewhere.
Biggest risks: bulk transfers bypassing the Merge+maintain review gate, audit/lineage fan-out under fail-closed strict mode, an SSRF-capable fetcher living inside the BFF trust zone, and SHA-256 evidence that is not itself tamper-evident.
Questions are tagged [Domain] or [Impl]; each lists options and a recommendation so the owner can answer quickly.

## Q1 [Domain] Does a bulk upload bypass the Merge+maintain review gate?
The owner decided that Merge+maintain is the review gate and that the e-signature is the maintain user signing at merge. Chunked upload, zip import and URL import need only write, and the completing call creates a commit. If that commit lands on the default branch, a writer has put unreviewed, unsigned data into the record set that the gate was supposed to protect. The small-file direct commit path already has this property, so the gap is existing but the spec widens it to terabytes.
Example scenario: Priya (write) imports a 40 GB zip of LC-MS runs straight onto main at 16:50. Nobody with maintain ever signs anything; Job pins at 17:00 reference that commit as if reviewed.
Options: (a) all bulk imports land on a system-created branch and need a merge; (b) writers may commit to default branch only if branch protection is off for the repo; (c) leave as is and document it. Trade-off: (a) is safe but adds a step and a branch-proliferation problem; (c) is cheapest but breaks the review-gate story.
Recommendation: (a), with branch protection on the default branch being what decides whether direct landing is allowed.
Challenges: "Chunk/import routes get explicit actions at repo write" combined with "Merge+maintain is the review gate".

## Q2 [Impl] What exactly is the unit of an Intent event for a chunked upload?
Under strict mode every mutation fails closed on Intent append, and the owner said no class is exempt. A 100 GB file at 4 MiB chunks is about 25,000 chunk requests plus create and complete. One Intent per chunk would hammer immudb and turn one immudb hiccup into a failed upload at chunk 18,000; one Intent per upload leaves 25,000 un-audited byte writes. The spec is silent on granularity.
Example scenario: immudb pauses for 8 seconds during a failover while Tomás uploads a 60 GB file; with per-chunk Intents he gets 503s mid-stream and must restart.
Options: (a) Intent at create, Outcome at complete or abandon, chunks covered by the upload id; (b) Intent per chunk; (c) batched chunk audit every N chunks. Trade-off: (a) is cheap but chunks are not individually evidenced; (b) is rigorous but unusably heavy.
Recommendation: (a), with the chunk manifest hashes recorded on the Outcome event, and an explicit statement that chunks are not independent mutations.
Challenges: "GXP_STRICT fail-closed for ALL mutations"; New gap on granularity.

## Q3 [Impl] Where is the SHA-256 computed and how does it survive resume?
The spec says SHA-256 is authoritative and the digest is streamed. The browser today hashes the whole file with XXH3 before uploading, so adding SHA-256 doubles the client pass. If the BFF computes it, resume breaks the streaming state because the running hash lives in one instance's memory while chunks of one upload may hit different BFF instances. Resume with offsets in PostgreSQL does not carry hash state.
Example scenario: Upload of a 30 GB file loses instance A at chunk 3,000; instance B continues and has no incremental SHA-256 state, so it must re-read 12 GB from oxen to hash.
Options: (a) client computes SHA-256 and BFF verifies by a final re-read; (b) BFF persists hash midstate every N chunks; (c) compute at complete by streaming from oxen. Trade-off: (a) trusts the client until verified; (b) is complex; (c) costs a full re-read.
Recommendation: (a)+(c): client digest as claim, BFF verification read at complete, result recorded; midstate only if measured too slow.
Challenges: "SHA-256 authoritative"; "Digest computation ... stream it" in Further Notes.

## Q4 [Domain] Is a SHA-256 manifest tamper-evident, or just another file the same actor can produce?
The manifest is produced by the BFF at transfer time and shipped with exports. Nothing says it is stored in immudb or signed, so a later auditor holding a zip and its manifest cannot prove the manifest was not regenerated. Oxen itself only stores XXH3-128, so the authoritative digest has no authoritative home after the response is sent.
Example scenario: An inspector asks Aiko to prove that the 2,300 files she exported in March match what was in the repo; she presents a manifest she can edit with any text editor.
Options: (a) record the manifest digest (and per-file digests) in the Outcome event in immudb; (b) additionally sign the manifest with a BFF key; (c) manifest is informational only. Trade-off: (a) is cheap and verifiable; (b) adds key management; (c) is not evidence.
Recommendation: (a) at minimum, (b) later.
Challenges: "SHA-256 manifest per transfer" as integrity evidence.

## Q5 [Domain] Is "export reads are not separately audited" compatible with Part 11 / Annex 11 and with the manifest's own claims?
The spec states export reads are not audited, yet the manifest lists actor and time. A record that names who exported what but is absent from the audit trail is internally inconsistent. Regulators care about who obtained copies of regulated records, especially bulk copies leaving the controlled system. The original plan itself listed auditing exports as a Phase 1 item.
Example scenario: A departing scientist exports the entire assay repository on their last Friday; the audit log shows nothing, while the manifest sitting on their laptop says exactly who did it.
Options: (a) audit every export as a single event with size and manifest digest; (b) audit only above a size threshold; (c) keep unaudited. Trade-off: (a) adds volume only per export, not per byte; (b) invites threshold gaming; (c) leaves an exfiltration blind spot.
Recommendation: (a), non-blocking for reads (not an Intent under strict) but mandatory best-effort Outcome.
Challenges: "Export reads are not separately audited"; "Auditing export reads" in Out of Scope.

## Q6 [Domain] What is an export legally: a working copy or a certified copy of a record?
Annex 11 expects the ability to obtain accurate and complete copies of records in a human-readable and electronic form. The spec treats the zip as a convenience. If users submit exports to regulators or sponsors, they will call it a certified copy and expect completeness evidence: commit id, branch state, total file count, exclusion of anything skipped.
Example scenario: A sponsor audit requests "all raw data for batch 114"; the export silently omits two files the user lacked read access to, and the manifest does not say so.
Options: (a) manifest declares commit Pin, counts, and any omitted or denied paths; (b) exports are always of an explicit commit; (c) documented as uncontrolled copy. Trade-off: (a)+(b) are cheap and defensible; (c) is simplest but pushes risk to users.
Recommendation: (a)+(b).
Challenges: "Export a directory or repository as an archive" without completeness semantics.

## Q7 [Impl] How is lineage recorded for a 50,000-file zip import when lineage writes also fail closed?
The owner made lineage writes fail closed under strict. A zip import creating 50,000 files either produces 50,000 lineage ops, each a database write that can fail, or one summarised op that loses per-file hash detail. The existing lineage classification is per file write; none exists for bulk. A mid-way lineage failure after the oxen commit succeeded leaves a committed import with a refused lineage write.
Example scenario: Lineage Postgres is briefly unavailable after oxen commits a 12,000-file import; the user sees 503 but the data is already in the repository.
Options: (a) one lineage op per import with a manifest reference; (b) per-file ops written in a single transaction before the oxen commit; (c) async fan-out from the Outcome event. Trade-off: (a) is light but coarse; (b) is precise but heavy; (c) violates fail-closed.
Recommendation: (a) with the manifest holding file-level detail, and lineage written in the same transaction as the Outcome projection.
Challenges: "Lineage writes are also fail-closed under strict"; plan item "Lineage ops for chunked, zip and URL imports".

## Q8 [Impl] What is the default when the URL-import destination policy is not configured?
The spec says URL import stays enabled and the policy is mandatory configuration, which is a contradiction in the empty-config case: either the BFF refuses to boot, or imports are denied, or the "mandatory" policy is defaulted to something. The original plan proposed disabling by default until a policy exists. Operators standing up a dev stack will not read the fine print.
Example scenario: A new deployment copies sample environment settings, leaves the allowlist empty, and the fetcher happily resolves internal metadata addresses.
Options: (a) refuse to start with import enabled and no policy; (b) disabled until policy is set; (c) built-in deny of private and link-local ranges with allowlist optional. Trade-off: (a) is strict and annoying; (b) is safe but surprising; (c) friendly but weaker.
Recommendation: (b) plus (c) as the floor even when a policy is set.
Challenges: "URL import stays enabled; the destination policy is mandatory configuration".

## Q9 [Impl] How is the fetcher isolated from the rest of the BFF trust zone?
An egress-restricted fetcher inside the BFF process shares its network identity with PostgreSQL, immudb and Novu connections. Application-level filtering of IPs is bypassed by DNS rebinding, IPv6 mapped addresses, redirects, and proxy settings. A real egress firewall needs a separate network identity, which depends on the undecided deployment target and the N-instance requirement.
Example scenario: An attacker supplies a hostname that resolves to a public address at validation time and to the immudb host at connect time; the BFF pulls an immudb status page into a repository.
Options: (a) separate fetcher service with its own network policy; (b) in-process fetcher pinning the resolved IP and re-checking per redirect hop; (c) both. Trade-off: (a) is robust but needs deployment work; (b) is quick but not defence in depth.
Recommendation: (b) now as the floor, (a) as a requirement before production.
Challenges: "BFF-controlled, egress-restricted fetcher"; deploy target undecided.

## Q10 [Domain] What provenance evidence is recorded for data pulled from an arbitrary URL?
ALCOA+ wants data to be attributable, original and accurate. Public data pulled from a URL has an unverifiable origin: the content can change between two fetches and the upstream may be compromised. The spec records an import but not source URL, fetch time, TLS certificate details, response headers, or any upstream checksum comparison.
Example scenario: Chen imports a reference genome from a mirror; six months later the mirror's file differs and nobody can show what was originally fetched or when.
Options: (a) record URL, timestamps, final redirected URL, status, headers, and the SHA-256 on the Outcome event and lineage; (b) allow optional upstream checksum verification; (c) require a checksum for regulated repositories. Trade-off: (a) is easy; (c) is strong but burdensome.
Recommendation: (a) always, (b) offered, (c) as a repository policy.
Challenges: "As an auditor, I want imports and uploads in audit and lineage" (too vague on content).

## Q11 [Impl] How are server-side import credential references stored, scoped and protected from misuse?
The owner wants credentials as server-side references rather than browser fields. That implies a secret store, an owner for each reference, rotation, and an authz rule for who may use it. A shared reference usable by any writer in a namespace lets a writer exfiltrate data from a private bucket into a repo they can read.
Example scenario: An admin registers a reference to a partner's SFTP-like HTTPS endpoint; a different writer in the namespace points it at a URL on the same host with a path she was never meant to reach.
Options: (a) references bound to a host pattern and a namespace; (b) per-user references only; (c) instance-wide references with admin approval. Trade-off: (a) is flexible with rules; (b) is safest but clunky for teams.
Recommendation: (a), host-bound, audited on every use, never returned by any API.
Challenges: "supply import credentials as server-side references" without a scoping model.

## Q12 [Impl] How are zip bombs, path traversal and special entries handled in zip upload and unpack?
Zip unpack is explicitly in scope, and the plan says the BFF buffers whole bodies today. A 5 GB zip can contain 5 TB of zeros, deeply nested paths, entries with absolute or parent-relative paths, symlinks, and name collisions differing only by case. The spec only talks about body limits.
Example scenario: A 40 MB archive expands to 8 TB and fills oxen's disk before any quota counter, which counts declared sizes, notices.
Options: (a) streaming unpack with ratio, total size, count and depth limits, rejecting special entries; (b) refuse zip import entirely and require tar through CLI; (c) unpack in a sandboxed job. Trade-off: (a) is feasible in BFF; (c) is safest but slow.
Recommendation: (a) with limits configurable and rejections audited.
Challenges: "request body limits and streaming" as the only control; New gap on archive content.

## Q13 [Impl] Where do quotas live and can they be enforced consistently across N BFF instances?
The spec leaves quota location open. BFF counters in PostgreSQL race under concurrent uploads from multiple instances and drift from reality, since oxen versions its data and deletes do not free blocks. Declared sizes at create can lie. Oxen accounting is authoritative but may not be queryable.
Example scenario: Two instances each admit a 300 GB upload against a namespace with 400 GB left; both complete and the volume fills.
Options: (a) reservation rows in PostgreSQL at create, reconciled at complete; (b) rely on filesystem quotas under oxen; (c) soft quota with alerts only. Trade-off: (a) is correct but needs reconciliation; (b) is robust but external; (c) cheap, not a control.
Recommendation: (a) plus (b) as a backstop, with a stated definition of quota as stored bytes including history.
Challenges: "Quota location ... is an implementation decision to resolve with the quota owner" (no owner named).

## Q14 [Domain] Is there malware scanning for data entering the controlled record, and what does quarantine mean for immutable history?
The plan proposed a pluggable pre-complete scan; the spec drops it silently. Labs ingest files from instrument PCs and external partners. Quarantine conflicts with the idea that committed history is immutable and retained forever, so the only clean time to refuse is before complete.
Example scenario: A partner's zip contains a macro-laden spreadsheet that lands in a repository mounted into every Desktop Session on the project.
Options: (a) optional scanner hook before complete, failing closed when enabled; (b) scan asynchronously and flag; (c) explicitly out of scope and documented as a customer control. Trade-off: (a) adds latency; (c) is honest but leaves a gap.
Recommendation: (c) stated explicitly now, (a) as the extension point.
Challenges: Dropped from the plan without a decision.

## Q15 [Domain] What counts as the "original record" when files arrive through a browser upload or zip?
ALCOA+ requires the original (or a certified copy) with contemporaneous context. A browser upload loses file modification times, creator tool metadata and sometimes line endings; zip unpack normalises names and timestamps. Instrument raw data frequently carries acquisition time in file attributes.
Example scenario: A plate-reader export has acquisition time only in its file modification time; after upload every file shows the commit time, so the contemporaneous timestamp is gone.
Options: (a) capture client file mtime and original name in the manifest; (b) declare upload a copy and require the instrument PC to retain the original; (c) recommend CLI/oxen push, which keeps more context. Trade-off: (a) is cheap but client-asserted; (b) shifts burden.
Recommendation: (a) captured as client-asserted, labelled as such, with (b) in guidance.
Challenges: New gap.

## Q16 [Impl] How are the mandatory reason and Principal attribution applied to thousands of chunk calls and to service principals?
Mutations require a reason, and service principals are in scope now. A browser or script uploading 25,000 chunks cannot meaningfully give 25,000 reasons, and an automated principal uploading nightly will use boilerplate. The spec does not say whether the reason attaches to create or complete only, or whether service principals are permitted to upload at all.
Example scenario: A scheduled service principal uploads daily files with reason "n/a" for nine months; the audit log is full but empty of meaning.
Options: (a) reason required at create and complete only; (b) reason per request; (c) service principals must carry a registered purpose string approved at creation. Trade-off: (a) is workable; (c) adds admin load.
Recommendation: (a)+(c).
Challenges: New gap between audit reasons and bulk routes.

## Q17 [Impl] Does the extra oxen read and lock before and after every mutation serialise uploads?
The owner decided every mutation reads the dataset head before and after with a lock. Applied to chunk PUTs this means 25,000 lock round trips per large file, and any per-repo lock makes two scientists uploading to the same repository wait for each other. The spec does not exempt chunk transfer from the rule.
Example scenario: Two teams upload 80 GB each to one repository; with a per-repo lock the second waits two hours, and a lock holder dying wedges the repo until a lease expires.
Options: (a) capture head only at complete (the commit-creating call); (b) capture at every request but without a blocking lock; (c) keep the lock per request. Trade-off: (a) matches where a dataset changes; (c) kills throughput.
Recommendation: (a), and state that chunks do not mutate the dataset head.
Challenges: "extra oxen read+lock before/after every mutation for dataset head".

## Q18 [Impl] What happens to abandoned and half-finished uploads when retention is forever and a reconciler infers outcomes?
An interrupted upload leaves received chunks in oxen or recorded offsets in PostgreSQL, and an Intent with no Outcome. The reconciler re-queries oxen to infer the outcome, but for an abandoned upload there is nothing in the repo to find, so the inference is "nothing happened", which may be wrong if chunks persist. Retention forever also seems to forbid cleaning them.
Example scenario: 400 abandoned 20 GB uploads accumulate over a quarter: 8 TB of orphan chunks and 400 dangling Intent events that every audit review has to explain.
Options: (a) uploads expire after a TTL with an explicit audited Outcome "abandoned" and chunk cleanup; (b) keep forever; (c) user-driven cancel only. Trade-off: (a) is clean; need a retention carve-out; (b) is costly.
Recommendation: (a), declared a carve-out from "retention forever" for incomplete transfers.
Challenges: "retention forever"; "reconciler re-queries oxen to infer outcome".

## Q19 [Impl] What are the throughput and resume expectations in numbers?
The chunk size is 4 MiB and sequential, and hashing happens first. For 200 GB genomics files this means 51,000 sequential round trips plus a full pre-read. The spec does not set targets, so there is no way to decide whether parallel chunks, larger chunks or a different protocol are required.
Example scenario: Over a 100 Mbit link a 200 GB file takes roughly 4.5 hours of pure transfer; a single 503 at hour four means starting over unless resume exists and works across instances.
Options: (a) set targets (e.g. 1 TB per file, resume within 1 chunk); (b) bounded parallel chunks with larger chunk size; (c) recommend CLI push for large data. Trade-off: (b) needs oxen support for out-of-order chunks.
Recommendation: (a) first; derive (b) or (c) from measurements.
Challenges: Phase 3 reliability items treated as optional.

## Q20 [Impl] How is export consistent and complete when it streams for an hour across multiple instances?
Export of a branch or directory must be a coherent snapshot even while writes land on the branch, and a truncated zip must be detectable. A zip is written sequentially, so a failure at 90% leaves a corrupt archive with a valid-looking name. The manifest, if placed at the end, never arrives.
Example scenario: A 300 GB export fails when a BFF instance is drained; the user sees a 300 GB file that opens with errors, and the manifest is missing.
Options: (a) resolve the branch to a Pin first and export that commit; (b) manifest first, with a trailing checksum entry; (c) offer resumable ranged downloads of a prepared artifact. Trade-off: (c) needs temporary storage.
Recommendation: (a)+(b).
Challenges: "export a directory or repository as an archive" without semantics.

## Q21 [Domain] Does read access alone justify bulk exfiltration of regulated data?
Export needs only read. A reader who has read on a repository, possibly through a broad namespace role, can pull everything in one click. Under GxP, access to data often requires current training, and bulk copying out of the controlled system is a distinct risk from viewing.
Example scenario: A contractor with read on a namespace exports 1.2 TB of unpublished trial data to a personal laptop in 40 minutes with no alert.
Options: (a) separate export action that roles can be granted independently; (b) rate limits and size alerts via Notification service; (c) keep as is. Trade-off: (a) adds role-model complexity.
Recommendation: (a) as an action even if default roles grant it with read, plus (b).
Challenges: "As a reader, I want exports to need only read access".

## Q22 [Impl] Is download by content hash authorised against the repository, or just against the hash?
Batch download by content hash is an existing route family. Content addressing lets a caller with read on repository A present a hash that belongs only to repository B. Whether the BFF checks that the hash is reachable from the repo in the URL or the oxen server just serves the blob is unknown.
Example scenario: Marcus has read on a public namespace; he guesses or leaks a hash from a confidential repo's lineage record and fetches it through his own repo path.
Options: (a) verify membership of each hash in the named repo before streaming; (b) rely on oxen's repo scoping; (c) remove the route. Trade-off: (a) costs a lookup per hash.
Recommendation: (a), with a test that crosses repo boundaries.
Challenges: Existing route not examined in the spec.

## Q23 [Domain] How does "retention forever" interact with personal data and erasure requests in imported datasets?
Imported clinical or genomic data can contain personal data. The owner chose no purge, and oxen history is append-only. GDPR erasure and sponsor-driven destruction of records are legitimate demands that this platform would be unable to meet, and the spec explicitly places retention policies out of scope.
Example scenario: A trial participant withdraws consent; the sponsor demands deletion of their file from every version, but history holds it in 140 commits and exports.
Options: (a) record that the platform cannot erase and require customers to keep personal data out; (b) design a controlled history rewrite procedure; (c) per-repository retention class. Trade-off: (b) breaks immutability and Pins.
Recommendation: (a) now, written into the intended-use statement, (c) later.
Challenges: "retention forever"; "Retention policies and automatic purging" out of scope.

## Q24 [Domain] What is the integrity-failure procedure when hashes disagree?
Post-upload verification compares client XXH3 with the server's and SHA-256 manifests. The spec does not say what state the version is in after a mismatch, who is told, or whether a mismatch is a data-integrity deviation requiring a record. A silent retry hides systematic corruption (bad disk, proxy altering bodies).
Example scenario: A corporate proxy rewrites line endings of text files in transit; 3% of uploads mismatch and users retry until they pass without anyone noticing the pattern.
Options: (a) mismatch fails the upload, writes an Outcome with failure class, notifies the admin category; (b) allow user override; (c) count only. Trade-off: (a) may block work on flaky networks.
Recommendation: (a), with no override.
Challenges: Test TC-DATA-07 exists but no process around it.

## Q25 [Domain] Do CLI push and clone transfers produce the same manifest, audit and lineage evidence as browser transfers?
The plan lists push and clone through the BFF, but the spec covers only upload, import and export. Push uses oxen's own protocol with many small requests and is how many scientists move data. If the SHA-256 manifest and Outcome event only exist for browser flows, the most common path has the weakest evidence.
Example scenario: Everyone on the team pushes 30 GB results with the CLI; the auditor asks for SHA-256 evidence and only the 5% uploaded via the browser has any.
Options: (a) BFF derives manifest and Outcome per push by inspecting the commit after the push completes; (b) declare CLI push out of the evidence scope; (c) route all large transfers through the browser flow. Trade-off: (a) is complex but uniform.
Recommendation: (a) at commit level, even if per-request audit stays coarse.
Challenges: Spec omits "CLI transfer" listed in the plan's scope.

## Q26 [Impl] How will we prove, in tests, SSRF defence, resume across instances and multi-GB behaviour?
Tests run at the BFF HTTP boundary against real containers. SSRF cases (rebinding, redirect chains, IPv6) need a controllable DNS and a fake external server inside the test network; multi-gigabyte uploads are slow in CI; resume across instances needs two BFF instances and a kill mid-upload. The spec lists categories but no strategy.
Example scenario: A rebinding test that depends on public DNS passes locally and flakes in CI, and the team disables it.
Options: (a) a test DNS and a rebinding stub container in the compose test profile; (b) unit-test the validator and trust it; (c) nightly large-file suite only. Trade-off: (a) is more infrastructure, deterministic.
Recommendation: (a) for SSRF and resume; (c) for size.
Challenges: Testing Decisions only list scenarios.

## Q27 [Impl] How are existing uploads and repositories without SHA-256 evidence treated?
The new manifest requires SHA-256 for each file, but existing repositories only have XXH3. Backfilling means reading every blob in oxen. A manifest for an old export will either hash on the fly, making export slow, or lack digests.
Example scenario: Exporting a 4 TB legacy repository takes 9 hours because every file is hashed during zip creation.
Options: (a) lazy hashing with a cache table in PostgreSQL, marked "computed at export, not at ingest"; (b) background backfill job; (c) manifest for new data only. Trade-off: (a)/(b) must label evidence strength honestly.
Recommendation: (a) with explicit evidence class per digest.
Challenges: "SHA-256 is authoritative" for all data.

## Q28 [Impl] What are the failure semantics for URL import that spans a long fetch under strict mode?
Strict mode appends the Intent before the mutation, but a URL import can take an hour and fail halfway, retried by nobody (no automatic retries). The reconciler would infer the outcome by re-querying oxen, which cannot see a half-downloaded file held by the BFF. The user-facing state during the fetch is not specified.
Example scenario: A 20 GB import fails at 18 GB when the remote resets the connection; the Intent is open for the next reconciler run to guess about.
Options: (a) import as a tracked operation record in PostgreSQL with explicit state machine and a terminal Outcome appended by the BFF itself; (b) rely on the reconciler; (c) retry automatically. Trade-off: (a) adds an entity but removes inference.
Recommendation: (a); the reconciler is the fallback only for crashes.
Challenges: "no automatic job retries" and "reconciler re-queries oxen to infer outcome" applied to a non-oxen-visible step.

## Decisions log

| Q | Answer | Date |
| --- | --- | --- |
| Q1 | Inherited: no direct writes on main; imports land on a branch + merge (05 Q11) | answered |
| Q2 | Intent at create, Outcome at complete/abandon, chunk hashes on Outcome | answered |
| Q3 | Inherited: SHA-256 in upload stream (00 Q14) | answered |
| Q4 | Manifest + per-file digests in Outcome event in immudb; BFF signing later | answered |
| Q5 | Inherited: reads audited (00 Q4, 03 Q15) | answered |
| Q6 | Export of explicit commit; manifest declares Pin, counts, omitted/denied paths | answered |
| Q7 | One lineage op per import referencing manifest, same txn as Outcome projection | answered |
| Q8 | Moot: URL import disabled (00 Q15) | answered |
| Q9 | Moot: URL import disabled; entry criteria must be defined before re-enable (owner: disabled) | answered |
| Q10 | Moot: URL import disabled | answered |
| Q11 | Moot: URL import disabled | answered |
| Q12 | Streaming unpack with limits; reject special entries; audited rejections | answered |
| Q13 | PG reservation rows + filesystem quota backstop; quota = stored bytes incl. history | answered |
| Q14 | Out of scope, customer control; scanner hook as extension point | answered |
| Q15 | Capture client mtime/name labelled client-asserted; guidance keeps instrument original | answered |
| Q16 | Inherited: no service principals | answered |
| Q17 | Head captured only at complete; chunks take no lock | answered |
| Q18 | TTL expiry with audited 'abandoned' Outcome; carve-out from retain-forever for incomplete transfers | answered |
| Q19 | Owner chose: bounded parallel larger chunks now (requires oxen out-of-order chunk support spike; note recommendation was targets first) | answered |
| Q20 | Pin then export; manifest first + trailing checksum; resumable ranged download of prepared artifact | answered |
| Q21 | Separate 'export' action (default included with Read) + size/rate alerts | answered |
| Q22 | Verify hash reachability from named repo; cross-repo test | answered |
| Q23 | Inherited: legal-retention stance (00 Q8) | answered |
| Q24 | Mismatch fails upload, Outcome with failure class, admin notified, no override, patterns reported | answered |
| Q25 | BFF derives manifest + Outcome per push/clone at commit level | answered |
| Q26 | SSRF tests moot (URL import disabled); other tests per recommendation assumed — confirm | answered |
| Q27 | Inherited: new project, no legacy | answered |
| Q28 | Moot: URL import disabled | answered |

---

# Known Issues and Conflicts

## Conflicts with Other Specs

1. **Parallel chunks before targets (Q19)**: Owner chose bounded parallel larger chunks first (requires oxen out-of-order chunk support spike). Recommendation was targets first. RISK.

2. **Branch+merge requirement (Q1)**: Inherited from 05 Q11. Bulk import flows need merger other than uploader (02 Q1).

3. **Per-push/clone manifests (Q25)**: Add load; derived data must reconcile via Postgres outbox.

4. **Incomplete transfer retention (Q18)**: TTL expiry with "abandoned" Outcome carves out from retain-forever. Needs confirmation with 03-audit retention. RISK.

5. **Export audit reversal (Q21)**: Reverses old "exports not separately audited" line. Follows 00 Q4 (all reads audited).

## Open Risks and Blockers

6. **URL import entry criteria (Q9)**: Entry criteria for re-enabling URL import not defined. DEFERRED.

7. **BFF signing of manifests (Q4)**: Deferred. Manifests recorded in immudb Outcome events only.

8. **Remaining tests (Q26)**: Assumed per recommendation; owner needs to confirm. PENDING.

## Unresolved Design Decisions

9. **Throughput expectations (Q19)**: No targets set (1 TB per file, resume within 1 chunk). Depends on measurements.

10. **Resume mechanism**: Depends on oxen exposing received-chunk state; otherwise BFF records offsets in PostgreSQL.

# Impact on Other Specs

## Dependencies on Other Specs

- **05 (Repositories)**: Q1 imports land on branch+merge (05 Q11); no direct writes on main
- **03 (Audit)**: Q2 Intent at create, Outcome at complete/abandon; Q18 incomplete-transfer TTL needs reconciliation
- **00 (Cross-cutting)**: Q3 SHA-256 inherited (00 Q14); Q5 reads audited (00 Q4); Q15 URL import disabled (00 Q15)
- **02 (Authorization)**: Q1 bulk imports need merger other than uploader (02 Q1)

## Impacts on Other Specs

- **11 (Lineage)**: Q7 one lineage op per import with manifest reference; same transaction as Outcome projection
- **06 vs 11**: Q16 no upload origin fields conflicts with 06 Q15 (client-asserted name/mtime). One owner per fact reconciliation needed.
- **12 (Metadata)**: Q15 client mtime/name captured as client-asserted

## Cross-Cutting Concerns

- **Fail-closed strict mode**: Q2 Intent at create covers chunks; chunk manifest hashes on Outcome
- **Multi-instance coordination**: Q17 head capture only at complete; chunks take no lock
- **Retention**: Q18 incomplete transfers expire by TTL (carve-out from retain-forever)
- **Integrity evidence**: Q4 manifest+per-file digests in Outcome event in immudb
- **SHA-256 authority**: Q3 inherited; computed in upload stream, verified at complete

