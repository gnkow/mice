# 09 — Jobs: grilling questions

Status: spec is `ready-for-agent`, but it depends on 08 (mount mechanism, overlay-on-RWX unresolved) and on deployment target; both Docker and Kubernetes runners are declared in scope.
Biggest risks: job state and queue that assume one BFF process, read-set evidence that cannot be trusted off a single Docker host, and auto-merge of results that bypasses the review gate.
Tags: [Domain] = regulated-science/GxP concern, [Impl] = engineering concern.

## Q1 [Impl] Observed read-set tracing cannot work uniformly on Docker, Kubernetes and shared RWX trees

The plan records a Job's inputs by watching file opens from the BFF host. That only sees reads when the watcher runs on the same kernel and filesystem view as the container. On Kubernetes the Job runs on an arbitrary node, and on a shared RWX filesystem or overlay mount, open/access events are frequently missing, coalesced or not propagated across nodes. The spec says nothing about how inputs are captured once N BFF instances and two runners exist. Inputs are the core of lineage, so this is not a detail.
Example: a training Job on Kubernetes reads `datasets/cohort_A/*.parquet` (4,200 files) from an RWX-mounted Workspace. The node-local watcher emits nothing, the Job succeeds, and lineage shows `inputs: []` for a result commit built entirely from cohort A.
Options: (a) in-container tracer (LD_PRELOAD/eBPF sidecar) per runner, higher complexity, works on both runners; (b) declared inputs only, authoritative and simple but relies on user honesty; (c) declared plus best-effort observed, with the evidence class stored per input.
Recommendation: (c), with each input tagged `declared` or `observed` and a per-Job `read_capture: complete|best_effort|unavailable` field; never display an empty read-set as "no inputs" when capture was unavailable.
Challenges: Plan §3 "best-effort read-set" and Phase 0 host-inotify tracer; spec is silent on tracing.

## Q2 [Domain] An incomplete read-set presented as provenance breaks "Complete" and "Accurate" in ALCOA+

Auditors will treat the lineage graph as the answer to "what data produced this result". The plan allows an empty read-set as valid and lets `input_globs` filter observed reads, so a user can narrow the recorded inputs after the fact. Nothing distinguishes "the job read nothing" from "we failed to see what it read". Under ALCOA+, a record that is silently incomplete is worse than one that says it is partial.
Example: an analyst submits a Job with `input_globs: ["datasets/final/**"]` although the script also read `datasets/excluded_patients.csv`. The audit trail shows a clean result commit with three inputs, and the exclusion file is invisible to the reviewer.
Options: (a) globs may only add declared inputs, never subtract observed ones; (b) globs remain a filter but both raw and filtered sets are stored; (c) drop globs entirely.
Recommendation: (b) at minimum, and (a) under `GXP_STRICT`; always store the unfiltered observed set with the capture-quality flag from Q1.
Challenges: Plan §4 "`input_globs` filter the recorded set, not replace it"; user story 6.

## Q3 [Impl] The job queue and concurrency cap are per-process, so N BFF instances double-run or starve Jobs

Queue order and the concurrency limit live in memory in each BFF process, and restart recovery re-enqueues from the database. With N instances behind a load balancer, each instance independently re-drives queued Jobs on boot and each applies its own cap. The result is duplicate execution of one JobRun, an effective cap of N times the configured limit, and Jobs that sit in `queued` because the instance that accepted them died. The spec requires N instances but defines no claim protocol.
Example: three BFF instances, cap 2, five queued Jobs. Instance B restarts and re-enqueues all five; instance A already started `job-7`. Two containers now run `job-7` against the same Workspace, and both try to commit to the same safe branch.
Options: (a) database claim with `SELECT ... FOR UPDATE SKIP LOCKED` plus heartbeat lease per JobRun; (b) a dedicated runner-controller process singleton with leader election; (c) delegate scheduling to Kubernetes only (drops Docker multi-instance).
Recommendation: (a), with the claim recorded as an owner instance id and lease expiry on the JobRun, and the global cap enforced by a counted query inside the claim transaction.
Challenges: Spec "N BFF instances required" vs the Jobs spec (no coordination design); plan §9 `JOBS_MAX_CONCURRENT`.

## Q4 [Impl] "Re-attach by job-id label" contradicts what restart handling does today and has no adoption rule across instances

The spec promises a restarted BFF re-attaches running executions by a label carrying the job id. The existing behaviour is the opposite: on boot every `running` Job is marked `failed` with "interrupted by auth restart", even though the container may still be running and may later commit. With N instances, "who re-attaches" is undefined: two instances may both adopt, or none. The label also proves identity only if nothing else can create a container with that label.
Example: instance A is rolling-restarted during a 6-hour Job. It marks the Job failed and the user resubmits; meanwhile the original container finishes at hour 6 and auto-commits, so there are two result commits for one scientific question.
Options: (a) lease-based adoption: only an instance that wins the JobRun lease may re-attach, label plus attempt nonce stored in the database; (b) never re-attach, mark orphaned and kill executions with the label; (c) re-attach on Kubernetes only, where the controller already owns the Pod.
Recommendation: (a), and the runner must refuse to commit if the JobRun lease generation changed since start (fencing).
Challenges: Spec decision "Re-attachment identifies executions by a label containing the job id"; user story 9.

## Q5 [Domain] Failed-job outputs that stay only in the frozen Workspace are unrecorded, mutable, and block the Workspace

The spec decided that outputs of failed or cancelled Jobs stay in the Workspace with no download operation. Those files are uncommitted, so they have no Pin, no hash recorded, no lineage and no immutability, yet scientists will read them to diagnose and may copy results out via a Desktop Session. The Workspace may also keep its write lease or stay marked busy. Retention is "forever", so each failure leaves permanent tree state.
Example: a Job fails at epoch 48 of 50 after writing a 120 GB `checkpoint.pt`. The scientist edits the file in a Desktop Session, resubmits, and later commits a model derived from an unrecorded, hand-edited checkpoint.
Options: (a) at terminal failure, snapshot the output manifest (path and SHA-256) into the JobRun and mark the Workspace content "uncommitted job residue"; (b) on failure commit to the safe job branch without merging, so outputs are Pinned; (c) keep as decided.
Recommendation: (a) minimum and consider (b) for strict deployments; add a visible banner on residue and prevent residue from being merged without an explicit acknowledgement.
Challenges: Spec decision "Failed-job outputs stay in the frozen Workspace"; user story 5; plan §15 Q5.

## Q6 [Domain] Auto-merge of a result into the target branch bypasses "Merge + maintain is the review gate"

The cross-cutting decision makes the maintain-role user's merge the review and e-signature point. The Job plan always commits to a safe job branch and then merges into the requested branch automatically as the submitter. That means a submitter with write access (not maintain) causes a merge into a protected target with no reviewer and no signature. The merge is authored by the Principal, but the content was machine-generated by arbitrary user-supplied code.
Example: a scientist with Write on `lab/trials` submits a Job targeting `main`; it merges at 02:10 with the scientist as author. `main` now contains an unreviewed model output, and the audit shows only `job.complete`.
Options: (a) Jobs never merge: the result stays on the safe branch and a human merges (review gate intact); (b) auto-merge only to non-protected branches, otherwise open a merge request; (c) keep auto-merge and require the submitter to hold maintain.
Recommendation: (a) or (b); under `GXP_STRICT` always (a). Resolve this against 05/02 branch protection before approving 09.
Challenges: Plan §6 step 7 "commit on `mice/job/<id>`, merge into requested branch"; cross-cutting e-sig decision.

## Q7 [Domain] Mutable image tags make a Job unreproducible; digest pinning is deferred to Phase 3 and optional

The reproducibility bundle includes the image digest only from Phase 3, and Phase 0 accepts a tag. Tags like `tool:1.2` can be re-pushed. A Job that is "pinned" to a data commit but not to the code that processed it is not reproducible, and an auditor cannot reconstruct what ran. The spec does not say whether a tag-only submission is accepted.
Example: `ghcr.io/org/tool:1.2` is rebuilt on 3 March with a changed numpy; a Job from February and one from March record the same image string but produce different outputs.
Options: (a) resolve tag to digest at submit and store both, reject if unresolvable; (b) require digest-form references only; (c) allow tags outside strict.
Recommendation: (a) always (resolution happens at the BFF, not in the runner), with (b) under `GXP_STRICT`; the resolved digest is part of the Intent event.
Challenges: Plan §4 "Image identity: Phase 0 may accept a tag"; spec silent.

## Q8 [Domain] Nobody validates the images that run on regulated data

Job images are software that processes GxP data. Annex 11 and computerized-system validation expect that software used for regulated records is qualified and change-controlled. The spec only has a pull allowlist (a registry list), not an approved-image catalogue with owners, versions and validation status. Any user with write access can run any image from an allowed registry.
Example: a scientist runs `python:3.12` with a pip-installed statistics package and an unversioned script; the resulting committed table feeds a submission, and QA cannot show the tool was qualified.
Options: (a) approved-image catalogue (digest-pinned, owner, validation reference) enforced under strict; (b) registry allowlist only (as planned); (c) per-repo image policy set by repo admins.
Recommendation: (a) under `GXP_STRICT`, (b) otherwise; record the catalogue entry id on the JobRun.
Challenges: Plan §4 network/pull allowlist as the only image control; New gap on CSV for images.

## Q9 [Impl] Fail-closed `GXP_STRICT` is undefined for Job transitions that have no triggering request

Under strict every mutation fails with 503 if its Intent event cannot be appended. A Job's start, container exit, auto-commit, merge and lease release are driven by the runner, not by a user request. If immudb goes down for 90 seconds mid-Job, the runner cannot append the Outcome event or the commit's Intent. "Refuse with 503" has no caller. Options include killing the container, pausing before commit, or committing and reconciling later.
Example: a 10-hour Job finishes at 23:58 while immudb is unreachable. The runner holds a complete result and must choose between discarding 10 hours of compute, committing without an Intent event (breaking the rule), or waiting.
Options: (a) the runner holds the result in the Workspace and retries the Intent append with backoff, leaving the Job in `finalizing`; (b) fail the Job and keep residue (see Q5); (c) append Intent events for the commit at submit time ("this Job may commit"), then only append Outcome later.
Recommendation: (c) plus (a): authorize the commit by an Intent at submit and a second at finalize, and add a `finalizing` status so the wait is visible.
Challenges: Cross-cutting "GXP_STRICT fail-closed for ALL mutations"; user story 7.

## Q10 [Impl] The extra oxen read and lock around every mutation collides with Job merges and long-held leases

The cross-cutting decision records `{base, head}` by reading the dataset head before and after each mutation under a lock. oxen-server has no lock primitive, so the lock is a BFF-side lock per repo and branch that must work across N instances. A Job's auto-commit and merge is a multi-step mutation (commit to safe branch, merge, update base), and it competes with interactive uploads on the same branch. Holding a lock for a merge of 100k files can block users; not holding it makes `{base, head}` inaccurate.
Example: a Job merging 80k files into `main` takes 7 minutes while three scientists attempt uploads to `main`; their requests wait, time out at the proxy and return 504, and `{base, head}` for their uploads is not recorded.
Options: (a) Postgres advisory lock keyed by repo id and branch with a bounded wait and 423 on timeout; (b) optimistic capture: read head before/after without a lock and mark the record `concurrent: true` when the head moved by more than this mutation; (c) restrict Jobs to the safe branch only and never lock the target.
Recommendation: (b) for interactive mutations, and (c) for Jobs; use locks only for merges.
Challenges: Cross-cutting dataset-head capture; plan §14 "Concurrent commits: safe branch then merge".

## Q11 [Impl] Kubernetes runner has no storage story that matches the spec

Plan §13 mounts the Workspace overlay volume on the Docker runner only and says Kubernetes "uses the copy/reflink driver until W7". The cross-cutting spec places trees on a shared RWX filesystem and leaves overlay on RWX unresolved. If overlay fails, Kubernetes Jobs copy the checkout per Job, which on a multi-terabyte dataset is both slow and a storage multiplier. The runner is also driven by shelling out to a CLI with BFF cluster credentials, so Pod identity, labels and namespace ownership are unspecified ("needs design").
Example: a 3 TB imaging repo; each Kubernetes Job copies the checkout to a scratch PVC (about 25 minutes, 3 TB). Five parallel Jobs consume 15 TB of RWX capacity and the storage class throttles.
Options: (a) gate Kubernetes Jobs on the 08 overlay spike outcome and mark them unsupported until then; (b) read-only dataset mount plus a small writable output volume, committing a diff afterwards; (c) CSI snapshot/clone per Workspace.
Recommendation: (a) with (b) as the interim design; remove "both runners in scope" from the ready-for-agent status until 08 is decided.
Challenges: Spec "Runners: Docker and Kubernetes" and status `ready-for-agent`; Depends on 08.

## Q12 [Impl] The Docker runner needs a root-equivalent socket and does not work across multiple BFF hosts

The Docker runner talks to a Docker engine, typically via a mounted socket that is root on that host. With N BFF instances on different hosts, a Job runs on whichever host claimed it, but the Workspace volume, logs and the cancel path are local to that host. The security story is "never expose the socket to the browser network", which does not address a compromised BFF or a malicious image escaping to the host.
Example: instances on hosts H1 and H2; the user cancels `job-9` via H2 while the container runs on H1, and the cancel request quietly does nothing.
Options: (a) Docker runner limited to a single-host dev/test profile and refused when more than one BFF instance is configured; (b) a separate runner daemon per Docker host with a node registry; (c) rootless Docker or Podman via a restricted API proxy.
Recommendation: (a) for production, and say so in the spec; production uses Kubernetes (blocked on Q11).
Challenges: Spec user story 10 and "Docker and Kubernetes runners"; plan §14 "Docker socket near BFF".

## Q13 [Domain] Service principals submitting Jobs weaken attribution

The author of a result commit is the Principal's IdP identity (author injection). A service principal has no human behind its `iss`+`sub`, so a result commit by `svc-nightly-etl` is attributable to a robot. Part 11 and ALCOA expect attribution to an individual or to a controlled, accountable owner. The spec says service principals are in scope now but defines no owner, no credential expiry and no approval.
Example: `svc-nightly-etl` submits a Job on `main` every night for a year; the owner leaves in May and the service principal's PAT is still valid in December, producing commits no human is responsible for.
Options: (a) every service principal has a named human owner and review date, and Job records carry `on_behalf_of`; (b) forbid service principals from committing results (read-only analysis only); (c) leave as decided.
Recommendation: (a), and offboarding of the owner revokes or reassigns their service principals; strict forbids merges by service principals (see Q6).
Challenges: Spec user story 13; cross-cutting "service principals in scope now"; manual offboarding only.

## Q14 [Impl] Cancel and force-release are in-process operations that fail when another instance owns the execution

Cancel today works through an in-memory map of cancel handlers in the process that started the run. With N instances the cancel request lands on a random instance. A cancel must also stop a commit that is already in progress, and it races with natural completion: the Job may finish, auto-commit, and then be reported cancelled.
Example: user clicks Cancel at the exact moment the Job exits 0 and begins the commit. The audit shows `job.cancel` while a result commit exists on the safe branch.
Options: (a) cancel is a database state transition (`cancel_requested`) honoured by the owning instance and by the runner via the execution label, with commit gated on that state; (b) direct runner kill from any instance by label; (c) only the owner instance may cancel, others proxy to it.
Recommendation: (a), with a defined terminal rule: once `committing` starts, cancel is rejected with 409 rather than half-applied.
Challenges: Spec user story 3; plan §6 step 5.

## Q15 [Domain] Secrets, credentials and personal data in `env`, commands and logs have no handling rule

The plan redacts "secret-shaped" env keys in logs and UI, but the full env is stored on the JobRun and travels in submit requests. A heuristic redaction misses `PGCONN` or a token passed as an argument. The Job also needs Oxen access to commit; "tighter secret injection for Oxen credentials" is an unchecked Phase 3 item, so the container may hold a usable credential with the submitter's rights for the Job's lifetime.
Example: a scientist passes `--api-key sk-live-…` as an argument for a vendor API. It is stored forever in the JobRun and in an audit detail and appears in a notification digest.
Options: (a) secrets only via named secret references resolved at runtime, with env values never stored; (b) store env encrypted and redact on read; (c) detect-and-block secret-shaped values at submit.
Recommendation: (a) with (c) as a guardrail; the container never receives a Principal credential, since the runner commits on its behalf.
Challenges: Plan §14 secret leakage mitigation; Phase 3 unchecked item.

## Q16 [Domain] Job logs are an ALCOA record but are mutable, truncated and have no integrity binding

Logs are the contemporaneous record of what the code did. They sit on a shared filesystem, are capped by a byte limit with truncation, and have no hash recorded in the Outcome event. Live streaming from a different BFF instance than the executor needs the file to be visible with low latency across RWX.
Example: a Job logs a failed QC check at line 90,000 and a script fills the 10 MB cap with progress bars. The decisive warning is truncated and the auditor sees a clean log.
Options: (a) store SHA-256 of the complete log, plus head and tail, in the Outcome event and keep the full stream in object storage; (b) hard cap but keep the last N bytes as well as the first; (c) leave as is.
Recommendation: (a), with a separate `log_truncated` marker; stream through a database-notified fan-out rather than file tailing on RWX.
Challenges: Plan §5 `max_log_bytes` and `log_ref`; spec user story 2.

## Q17 [Domain] Retention forever collides with privacy, cost and legal hold for Job artefacts

Logs, residue outputs, Workspaces and JobRuns are all kept until deleted, and deletion authority is not defined. Env values, commands and logs can contain subject identifiers or personal data, which raises erasure requests that "forever" cannot satisfy. Meanwhile 120 GB residue directories accumulate. A decision to keep everything is also a decision about who may delete anything.
Example: a clinical-data Job logs patient IDs; a data subject exercises an erasure right and the platform has no way to remove log lines without breaking the log hash from Q16.
Options: (a) separate classes: JobRun metadata kept forever, bulky residue and logs under a configurable retention with legal-hold flag; (b) keep everything and require manual deletion by admin with a signed reason; (c) keep as decided.
Recommendation: (a) with per-namespace overrides, and an explicit "no personal data in logs" user policy.
Challenges: Spec "Retention: until deleted"; cross-cutting "retention forever"; plan §9 Phase 5 retention bullet.

## Q18 [Impl] The Job identity is documented as opaque but the Docker path derives it from the result commit

The plan calls the Job id an opaque id and links a commit to a Job via the commit message and the JobRun record. The current code comment says that for local Docker runs the canonical job id is the result commit id. Those two models give different answers to "can there be two Jobs for one commit", "what is the id of a Job that produced no commit", and "what happens on retries or resubmits".
Example: a resubmitted Job whose output is byte-identical produces an identical commit; the second Job is indistinguishable from the first by id and overwrites its record.
Options: (a) opaque unique ids everywhere, commit ids only as attributes; (b) keep result-commit-derived ids for local runs; (c) separate "execution id" from "result id".
Recommendation: (a), and state in the spec that a JobRun id is never reused.
Challenges: Plan §4 "Job ↔ commit link (locked)" vs existing local Docker behaviour.

## Q19 [Domain] Revoking an identity does not stop their queued or running Jobs

Admin revoke by `iss`+`sub` is the decided group-revocation path and invalidates Sessions and earlier PATs. A queued or running Job is already authorized, and its eventual commit is authored as the revoked Principal. Manual offboarding means there may be a gap of days.
Example: a departing scientist is revoked at 09:00; a 12-hour Job submitted at 08:30 finishes at 20:30 and merges a commit authored by the revoked person into `main`.
Options: (a) revocation cancels the Principal's queued and running Jobs and blocks commit on revocation; (b) completes the Job but holds the result on the safe branch pending review; (c) leave running Jobs alone.
Recommendation: (a), recorded as a system cancel with reason "principal revoked", plus a repo-admin override to adopt the result as a new Job.
Challenges: Cross-cutting "admin revoke per iss+sub is the group-revocation path".

## Q20 [Impl] Stuck-job detection has no owner and a circular dependency with 14

The spec defers thresholds and recipients to 14, and 14 will project audit events into Novu. A job "stuck in queued" or "silent running" is not an audit event; it is a periodic state evaluation. With N instances each running a detector, duplicates or no alerts happen. "No log output for a fraction of the timeout" is wrong for batch tools that are silent until the end.
Example: a legitimate 8-hour alignment step is quiet for 6 hours, triggering 3 stuck alerts to all repo admins per instance (9 notifications) under "all categories on by default".
Options: (a) a single database-leased detector emitting a deduplicated system event with a stable key; (b) per-job optional heartbeat interval declared at submit; (c) only flag `queued` beyond a threshold, never "silent".
Recommendation: (a)+(c); drop silence detection until a heartbeat contract exists.
Challenges: Spec "Stuck-job thresholds and recipients are decided in 14"; user story 12.

## Q21 [Domain] There is no fairness, quota or accelerator model for scarce compute

The spec mentions limits per Job but not per user, per namespace or per queue. A scientist can enqueue 200 Jobs and starve others, with `JOBS_MAX_CONCURRENT` as the only brake. GPUs and other accelerators are absent from the resource model, although ML workloads drive demand. Resource units are "documented at implement".
Example: one user submits a 300-Job parameter sweep at 17:00; a regulated QC run for a batch release queued at 17:05 waits until morning.
Options: (a) per-namespace quotas and weighted fair queue with an admin priority class; (b) simple per-user concurrent cap; (c) delegate to Kubernetes queueing (Kueue) and drop it for Docker.
Recommendation: (b) now, (c) for Kubernetes, and a defined unit for CPU, memory, disk and GPU in the spec.
Challenges: Plan §9 Phase 5 "resource-quota warnings"; New gap.

## Q22 [Impl] Workspace write leases need fencing, not just TTL and force-release

A Job holds the Workspace write lease for `timeout + grace` seconds, with an admin force-release path. Clock skew across instances, a stalled renewer, or a force-release while the container keeps running lets a second writer begin while the first still writes to the same tree. A tamper hash is checked only at start. Leases live in files on disk today and must move to the database.
Example: an admin force-releases a lease on a Workspace used by a stuck Job whose container is still alive; a Desktop Session takes the write lease and both processes write `results.csv`.
Options: (a) monotonically increasing fencing token checked at commit and by the runner on every lease renewal; (b) force-release always kills the holder by label before freeing; (c) keep the TTL model.
Recommendation: (b) plus (a), enforced with database time rather than instance clocks.
Challenges: Plan §13 "Lease release" decisions; Depends on 08.

## Q23 [Domain] Resubmit without linkage lets users run until the answer looks right

With no automatic retries and no `retry_of`, each resubmission is a separate JobRun and nothing ties the failed attempt to the later success. For data integrity this is the "testing into compliance" pattern: repeating an analysis until the output passes and keeping only the passing run as the story. The failed runs exist but are not presented to a reviewer.
Example: a potency calculation fails the system-suitability criterion in runs 1 to 4 and passes in run 5 after seed changes; the review UI shows only run 5's commit and lineage.
Options: (a) resubmit creates an explicit `resubmit_of` link and the result commit's lineage lists prior attempts with the same pin and command family; (b) a reason-for-resubmit field mandatory under strict; (c) leave unlinked, rely on audit.
Recommendation: (a) and (b); show attempts count on the result.
Challenges: Spec "No automatic retries; each submission is its own JobRun"; plan §15 Q2.

## Q24 [Impl] The JobRun row will carry unbounded input and output lists

`inputs[]` and `outputs[]` store path and hash for every read and written file in a single record. Datasets with 500k files produce a row of tens of megabytes, slow list endpoints and expensive JSON updates in PostgreSQL. The same data is duplicated again as lineage edges.
Example: an image-processing Job reads 640,000 tiles; the JobRun JSON is 90 MB, and listing the repo's last 50 Jobs transfers gigabytes.
Options: (a) normalized job-file table keyed by JobRun id with paging, with the JobRun carrying counts and a manifest hash; (b) store the manifest as an object and keep only the digest in the database; (c) cap counts and collapse to directory prefixes.
Recommendation: (a) and make lineage the only edge store for Job I/O (single writer, see 11).
Challenges: Plan §5 JobRun record; "Job store: durable JobRun" (JSONL history).

## Q25 [Impl] The prescribed test seam hides the failure modes that matter for Jobs

Tests run Jobs with a fake runner at the interface and one real Docker run. That verifies state transitions but not tracing, overlay mounts, Kubernetes behaviour, cancel races, restart adoption or the two-instance claim. The multi-instance rule requires two BFF instances against the same databases, yet a fake runner cannot prove exclusive claim of a real container.
Example: the claim logic is correct for the fake runner, but a real container is started twice because the label check races; the suite passes.
Options: (a) a deterministic fault-injection runner (delay, crash, double-start) at the interface plus a nightly suite on real Docker and a kind cluster; (b) only real runners in CI; (c) keep as decided.
Recommendation: (a), with explicit two-instance tests for claim, cancel and adopt, and a restart-chaos test that kills an instance mid-Job.
Challenges: Spec "Testing Decisions"; cross-cutting multi-instance testing.

## Q26 [Domain] The Pin is not what the Job actually read when uncommitted Workspace edits are visible

Jobs run on a Workspace, and the plan states that uncommitted edits in the Workspace are visible to the Job. The Job's Pin is a commit, but the effective input is commit plus an upper layer of unrecorded changes (only an `upper_hash` is kept). A Job can therefore claim a Pin that does not describe its inputs, and a rerun at the Pin gives different results.
Example: a scientist hand-edits `config.yaml` in a Desktop Session, runs a Job against Pin `a1b2c3`, and commits the result. Rerunning at `a1b2c3` fails because the edit was never committed, and no record captures the edit.
Options: (a) refuse Jobs on a Workspace with uncommitted changes unless `allow_dirty` is set, and snapshot the dirty diff as an artefact; (b) auto-commit the dirty state to a safe branch before the Job, and Pin that commit; (c) keep as decided with `upper_hash` only.
Recommendation: (b) under strict, (a) otherwise.
Challenges: Plan §13 "Uncommitted edits in the workspace are visible to the job"; user story 1.

## Q27 [Impl] "Succeeded" is ambiguous when the commit or merge step fails

The status set has `succeeded` for exit 0, and merge conflicts "are reported on the job without losing the job-branch commit". There is no status for exit 0, commit made, merge failed, or commit failed after a good run. The Outcome event and notifications need to say which. With the lineage rule from 11, the lineage write is also part of the same flow.
Example: a Job exits 0, commits to `mice/job/55`, but the merge hits a conflict. The UI shows `succeeded` with `result_commit` set, so dashboards count it as success while `main` lacks the data.
Options: (a) split `execution_status` and `delivery_status` (committed, merged, conflict, skipped); (b) add `succeeded_unmerged` terminal state; (c) treat merge failure as `failed` with residue.
Recommendation: (a), with Outcome events carrying both.
Challenges: Plan §5 status enum; §14 "merge conflicts reported on the job".

## Q28 [Impl] Repository rename mid-Job breaks the commit and merge targets

Rename is decided as copy plus delete at the BFF with a stable repository id. A queued or running Job references namespace and repo names, a Workspace tied to the old repo and an old commit Pin. If the rename happens while the Job runs, the result commit target no longer exists and the Pin may not exist in the copy (see 11).
Example: a repo admin renames `lab/trials` to `lab/trials-v2` at 14:00 while `job-31` runs; at 16:00 it tries to merge into a repo that no longer exists and loses its result.
Options: (a) rename refused while non-terminal Jobs or leases exist in the repo (423); (b) Jobs reference repository id and are re-resolved at commit time; (c) Jobs are cancelled by rename.
Recommendation: (a) with (b) for the stored reference; always audit which Jobs were blocking.
Challenges: Cross-cutting rename decision; spec silent on Jobs vs rename.

## Decisions log

| Q | Answer | Date |
| --- | --- | --- |
| Q1 | In-container tracer (eBPF/LD_PRELOAD) per runner (owner chose over declared+best-effort; needs spike, privileges implications) | answered |
| Q2 | Drop input_globs entirely | answered |
| Q3 | DB claim FOR UPDATE SKIP LOCKED + heartbeat lease; global cap in claim txn | answered |
| Q4 | Lease adoption with attempt nonce; runner refuses commit if lease generation changed | answered |
| Q5 | Inherited: 08 Q3 / 04 Q12 | answered |
| Q6 | Inherited: no auto-merge to main; human signature (05 Q11, 08 Q7) | answered |
| Q7 | Resolve to digest at submit; store both; digest-only always; digest in Intent | answered |
| Q8 | Approved-image catalogue enforced; entry id on JobRun | answered |
| Q9 | Hold result, retry Intent in visible 'finalizing'; Intent at submit + at finalize | answered |
| Q10 | Inherited: 00 Q6 | answered |
| Q11 | K8s unsupported until overlay spike; interim RO dataset mount + small writable output volume | answered |
| Q12 | Inherited: separate runner service (08 Q22) | answered |
| Q13 | Inherited: no SPs | answered |
| Q14 | Cancel = DB state transition; 409 once committing | answered |
| Q15 | Secret references only; detect-and-block; no user credential in container | answered |
| Q16 | Log SHA-256 (+head/tail) in Outcome; full log durable; log_truncated marker | answered |
| Q17 | JobRun metadata forever; logs/residue configurable retention + legal hold + namespace overrides | answered |
| Q18 | Opaque unique ids, never reused | answered |
| Q19 | Inherited: 01 Q20 | answered |
| Q20 | Single DB-leased detector; queued-threshold only; no silence detection | answered |
| Q21 | Per-user cap, resource units, admin priority class; K8s queueing later | answered |
| Q22 | Inherited: 08 Q4 | answered |
| Q23 | Owner: leave resubmits UNLINKED (risk: 'testing into compliance' not visible; flagged for QA review) | answered |
| Q24 | Normalized job-file table + counts/manifest hash on JobRun; lineage single edge store | answered |
| Q25 | Fault-injection runner + nightly real Docker + kind; two-instance tests | answered |
| Q26 | Refuse Jobs on dirty Workspace always (no allow_dirty) | answered |
| Q27 | Split execution_status and delivery_status; Outcome carries both | answered |
| Q28 | Inherited: static repo names (05 Q25) | answered |
