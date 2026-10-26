Status: ready-for-agent

# 10 — Desktop Sessions (PLAT-SESS)

## Problem Statement

Scientists need a Linux desktop near their data over RDP. Regulated deployments need policy control over clipboard, drives and egress.

## Solution

Provisioned Desktop Sessions with a gateway, lifetime and idle limits, a security policy (clipboard/drive off by default) and enforced egress. Sessions are never recorded.

## User Stories

1. As a scientist, I want to start a Desktop Session, so that I get a Linux desktop.
2. As a scientist, I want to connect from the browser, so that I need no client.
3. As a scientist, I want to reconnect after a drop, so that work is not lost.
4. As a scientist, I want to stop and retry a failed session.
5. As a scientist, I want a warning before the lifetime ends, so that I can save.
6. As an instance admin, I want unattended sessions suspended or stopped after N minutes from disconnect, so that resources are freed.
7. As a security reviewer, I want clipboard and drive redirection off by default, so that data does not leak.
8. As a template owner, I want to relax those in non-strict deployments, so that my workflow works.
9. As a compliance lead, I want only instance admins to relax them under `GXP_STRICT`.
10. As a security reviewer, I want guest egress enforced by the provisioner, with Oxen via BFF always allowed.
11. As a compliance lead, I want one read-write session per Workspace with lease-holder attribution and off-box auditd records correlated by session id, so that activity is attributable without recording.
12. As an auditor, I want session start, connect, disconnect, stop and policy changes audited.
13. As an operator, I want quotas on session hours.

## Implementation Decisions

- Idle timer is driven by gateway events from disconnect; idle suspends, lifetime stops (disk kept N days), destroy only by user or admin.
- Policy defaults: clipboard and drive off; template owner may relax outside strict; instance admin only under strict. Only gateway-enforceable policies are offered.
- Egress is enforced by Docker network or NetworkPolicy; Oxen reachable through the BFF via a dedicated data-path endpoint.
- Recording of desktop sessions never happens, in any mode (owner decision reversing 00 Q22).
- Kubernetes is the production target, so sessions run as pods; Docker only for single-host dev. libvirt/KubeVirt stubs are dropped.
- Gateway: guacd/rustguac default; IronRDP relay is fallback-only pending matrix decisions.
- Auto-recovery scope beyond `failed`/`stopped` and quota units are open and should be decided in implementation.

## Testing Decisions

- HTTP tests of lifecycle and policy enforcement; connection parameters verified at the gateway boundary.
- Prior art: existing sessions e2e.

## Out of Scope

Recording of any kind, IronRDP primary gateway, libvirt/KubeVirt provisioners.

## Further Notes

Per-feature clipboard policy cannot be enforced if the gateway cannot parse virtual channels.

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Lifecycle
- DB-leased sweeper with CAS transitions; idle derived from gateway events (Q1).
- Generation-column CAS and a state machine table; Intent/Outcome per transition (Q20).
- Lifetime stops (disk kept N days), idle suspends, destroy only by user or admin; 15/5 minute warnings, one extension (Q2).
- One bounded extension, deduplicated warnings, audited (Q22).
- Concurrent-create race left as is, flagged (Q13).
- Guest data outside the mount is not preserved; documented (Q21).

Recording and attribution
- Recording never; supersedes the recording-storage design (Q3, Q4).
- Compensating controls: one read-write session per Workspace with lease-holder attribution, and off-box auditd correlated by session id (Q4, Q10).
- Analysis/review only; no primary capture; stated in the validation scope (Q24).
- Workspace layer is treated as a non-record; commits are required at acquisition, no auto snapshots (Q12).

Policy, security and data path
- Desktop is treated as inside the data boundary and relies on repository authz (Q5).
- Offer only gateway-enforceable policies; conformance test; guest lockdown (Q6).
- Dedicated guest-facing data-path endpoint with a session-scoped desktop principal (Q9).
- One-time per-connect guest credential, never stored (Q19).
- Sensitivity label; block mixing; deny read-write plus restricted read-only; admin exceptions (Q28).
- Stateless signed tickets; drain docs; reconnect grace (Q7).

Templates, gateway, platform
- Versioned immutable admin-owned templates; version and digest on the session (Q15).
- Gateway has a named owner, pinned digests, SBOM, patch SLA; qualification is an entry criterion (Q8).
- Durable gateway event queue; reconciler polls; "observed" marker; never fail closed for observations (Q16).
- Pods under Kubernetes, Docker if single-host; libvirt/KubeVirt stubs dropped (Q14).
- Read-only Workspace mounts until the 08 spike, then a mount abstraction (Q26).
- Nightly protocol conformance plus per-PR parameter assertions; recording tests dropped (Q25).

## Conflicts and open risks

- Q4 OVERRODE 00 Q22 and 04 Q22 (recording mandatory for GxP-touching Sessions); those logs and specs still say mandatory. Regulatory risk: no primary capture, accepted by owner.
- Q13: concurrent-create race remains, "as is".
- Q21: guest outside-mount data loss, "as is", documented only.
- Q14: now resolved by 16 Q1 (Kubernetes); the pod provisioner is the target, Docker dev-only.
- Q26: depends on the 08 spike (overlay-on-RWX); fallback copy/node-local scratch.
- Q5: no separate threat model for the desktop; relies on repo authz (accepted risk).
- Q12 and 08 Q2: Workspace layer is non-record and transient; loss risk is stated.
- Q18 and 01 Q20: revoke terminates Sessions; Q17 no break-glass.
- Q8: qualification entry criterion for the gateway is not yet scheduled (PENDING).

---

# Open Questions


Status: spec is `ready-for-agent`; Phase 0-2 of the plan exist, Phase 4 (security, recovery, cost) is proposed only, and only the Docker provisioner is real (VM provisioners are stubs). Deployment target is undecided.
Biggest risks: the clipboard/drive/egress controls give weaker assurance than the spec implies, optional recording under strict, lifecycle state and sweepers written for one BFF process, and unrecovered data in guest desktops.
Tags: [Domain] = regulated-science/GxP concern, [Impl] = engineering concern.

## Q1 [Impl] Every BFF instance runs the lifecycle sweeper, and the idle rule does not match the spec

Today a 60-second sweeper in each BFF process lists all Desktop Sessions and tears down those past the lifetime or idle limit. With N instances each tick runs N times concurrently: double stop, double audit events, and a race with a user's reconnect. The spec says the idle timer starts at disconnect, but the existing check measures time since the last recorded lifecycle activity (create, connect, stop), not RDP inactivity or disconnect.
Example: a scientist is connected and working for 3 hours with an idle limit of 60 minutes; `last_activity` was set at connect, so the sweeper stops the desktop while they type, and a second instance repeats the stop and emits a second `session.stop` audit event.
Options: (a) one leased sweeper election in the database plus compare-and-set on status transitions; (b) per-session timers owned by the instance holding the gateway socket; (c) an external scheduler (Kubernetes CronJob) driving a BFF endpoint.
Recommendation: (a), and define idle as "no connected gateway socket and no input activity for N minutes", measured from gateway events.
Challenges: Spec "Idle timer starts at disconnect"; cross-cutting N BFF instances.

## Q2 [Domain] Destroying a desktop on max lifetime or idle loses unsaved scientific work

The sweeper hard-destroys at max lifetime (status `destroyed`, container and volumes removed) and the plan's warning banner is an unchecked Phase 4 item. The spec says unattended sessions are "suspended or stopped", which are different outcomes: suspend preserves memory and guest state, stop preserves disk, destroy loses both. Scientists run GUI tools with autosave outside mounted Workspaces.
Example: an analyst has a 9-hour R session with an unsaved model in memory and a half-edited script in the guest home directory; the 8-hour max lifetime destroys it at 16:00 with no warning.
Options: (a) lifetime ends in stop (disk kept, retained for N days), idle ends in suspend, destroy only by user or admin; (b) warn at 15 and 5 minutes with bounded extensions, then stop; (c) keep hard destroy and require saving into a Workspace.
Recommendation: (a) plus (b), and the spec must say which of suspend, stop, destroy applies to which limit.
Challenges: Spec story 6 "suspended or stopped"; plan §8 Phase 4 warnings unchecked.

## Q3 [Domain] Optional recording under `GXP_STRICT` contradicts allowing relaxed clipboard or drives

The spec lets an instance admin relax clipboard and drive redirection under strict and keeps recording optional everywhere. When clipboard or drive redirection is relaxed, data can leave the controlled environment without any trace beyond a connect event. Recording is the only compensating detective control for a remote desktop. A policy that permits the leak path and makes the detective control optional is inconsistent.
Example: under strict, the instance admin enables drive mapping for template `imaging-gui` so a scientist can copy a 40 GB scan to a USB-mapped drive. Recording is off; an auditor later cannot tell what was copied.
Options: (a) strict forbids relaxing clipboard/drive unless recording is on; (b) strict forbids relaxing them at all; (c) keep as decided and rely on the audit of the policy change.
Recommendation: (a), and the relaxation is a signed, time-bound exception on the Desktop Session.
Challenges: Spec "Recording is optional everywhere, including strict"; user stories 9 and 11.

## Q4 [Impl] Recording has no storage, integrity, access or retention design, and retention is "forever"

Recording is only a flag. Guacamole recordings are large (hundreds of MB per hour of screen activity), are written by the gateway rather than the BFF, and must be tamper-evident to be audit material. With N instances and a gateway that may restart, who owns the files, where they are stored, who may view them (and is viewing audited), and how the notice is shown are all undecided. Retention forever means linear storage growth with no deletion path.
Example: 50 users record 6 hours a day at roughly 300 MB per hour: about 90 GB per day and 33 TB a year, with no policy for deleting recordings of a departed user's session.
Options: (a) object storage with SHA-256 recorded in an audit event at session end, viewing requires a reviewer role and is itself audited; (b) store recordings on a shared filesystem next to Workspaces; (c) defer recording out of the spec until the 04 policy is set.
Recommendation: (a), with retention aligned to the longest record the session touched, and explicit deletion by a signed admin action.
Challenges: Spec "viewers, storage and notice behaviour to be specified with the feature"; cross-cutting "retention forever".

## Q5 [Domain] "Clipboard and drive off by default" is not a data-loss control; the threat model is missing

Disabling clipboard and drive redirection stops two channels. A user with a full desktop can still photograph the screen, retype values, print to PDF into a mounted Workspace, upload to any host the egress policy allows, or push to a different repository through the platform. The plan lists printing, audio and screen capture as Phase 4 items. Without a stated threat model, "off by default" gives auditors false assurance.
Example: a user with Read on a restricted cohort repo opens the table in the desktop, takes a screenshot in the guest, and commits it as `screens.png` to a repo they can Write that has broader access.
Options: (a) write a short threat model enumerating channels and mark each as blocked, detected (recorded) or accepted; (b) treat the desktop as inside the data boundary and rely on repo-level authorization and audit; (c) keep as decided.
Recommendation: (a), and describe the controls as risk reduction, not prevention, in validation documents.
Challenges: Spec user story 7; Out of Scope list.

## Q6 [Impl] The clipboard policy can only be enforced where the gateway understands the virtual channel

The spec notes that per-feature clipboard policy cannot be enforced if the gateway cannot parse virtual channels, then makes guacd/rustguac the default and IronRDP fallback-only. Guacamole's parameters switch clipboard or drives on or off wholesale; direction control and file-type filtering are not equivalent to a DLP policy. The guest's own xrdp channel settings are a second place the same policy lives, and a user with a guest administrator account can change them.
Example: policy says "host-to-guest only"; the gateway parameter disables the paste-to-host direction, but a user with root in the guest enables an SSH tunnel out and bypasses clipboard entirely (see Q9).
Options: (a) enforce at the gateway with parameters, verify per Desktop Session in a conformance test, and drop direction/type granularity from v1; (b) additionally lock down the guest (no root, read-only xrdp config); (c) build an IronRDP relay that parses channels.
Recommendation: (a) and (b); make the policy values the gateway can enforce the only ones the product offers.
Challenges: Spec Further Notes; "Gateway: guacd/rustguac default; IronRDP fallback-only".

## Q7 [Impl] Gateway and Connect tickets across N BFF instances and restarts

Browser connections go through a WebSocket path on the BFF to the gateway. A rolling deploy or an instance failure drops every desktop connection routed through it; connect tickets and gateway session state live in one process. The spec requires multiple BFF instances but does not say where WebSocket state lives, whether load-balancer stickiness is required, or whether the gateway is itself highly available.
Example: a 4-instance deployment is rolled one at a time for a patch; 60 users lose their desktops' connections within minutes and the gateway reports 60 disconnects, starting 60 idle timers at once.
Options: (a) stateless BFF tickets (signed, verified by the gateway), gateway connections terminated by the gateway not the BFF; (b) sticky routing and drain-before-restart; (c) single dedicated gateway-facing BFF instance.
Recommendation: (a), with drain semantics in deployment docs and a reconnect grace period before the idle timer counts a disconnect.
Challenges: Cross-cutting "N BFF instances required"; spec silent on gateway HA.

## Q8 [Domain] rustguac, guacd and the desktop image are unqualified suppliers on a regulated data path

rustguac is a small community project, guacd and xrdp are open source components, and the desktop image bundles an OS and applications. Annex 11 expects supplier assessment, and the platform's security posture (egress, clipboard enforcement) rests on rustguac and guacd behaving as documented. The spec names no support, vulnerability-response or upgrade process.
Example: a guacd CVE with remote code execution is published on Friday; nobody owns monitoring or has a tested patch path, and the vulnerable gateway sits between the browser and every guest.
Options: (a) named owner, pinned digests, SBOM and a patch SLA for gateway and desktop images, tested in a validation environment; (b) fork and vendor rustguac; (c) replace the gateway with a commercial supported product.
Recommendation: (a), and the spec must list gateway and image qualification as an entry criterion for strict deployments.
Challenges: Spec "Gateway: guacd/rustguac default"; New gap.

## Q9 [Impl] "Oxen via BFF always allowed" turns the BFF into the exfiltration and lateral-movement path

Guest egress is restricted by network policy, but Oxen is always reachable via the BFF, so the guest can reach the whole BFF API surface. A user can push data to any repository they can write, call administrative or job APIs, and use the BFF as a proxy to its own upstreams. PATs or session cookies available in the guest become pivot credentials. DNS and allowed hostnames provide further covert paths.
Example: a user runs a script in the guest that posts 12 GB of a restricted cohort to a personal repo `alice/scratch` through the BFF; egress rules were satisfied because the destination was the BFF.
Options: (a) a dedicated guest-facing endpoint exposing only the Oxen data path, with its own authorization context (desktop principal, repo-scoped) rather than the full BFF; (b) full BFF reachable but tagged with `via: desktop` and per-desktop rate and volume limits; (c) as decided.
Recommendation: (a), plus audit tagging and the guest's repo scope fixed to its mounts.
Challenges: Spec "Oxen via BFF always allowed"; user story 10.

## Q10 [Domain] Actions inside the desktop are not attributable, only the connection is

Audit records create, connect, disconnect and stop. What a user did inside the desktop (opened files, modified data, ran tools) is outside the Intent/Outcome model; only commits through the BFF carry a Principal. A guest login is mapped from IdP identity, but the guest may allow `sudo`, so activity can be altered or obscured. Auditors will ask who changed a file in the Workspace upper layer before it was committed.
Example: two scientists' sessions mount the same Workspace read-write sequentially; a changed value in `assay.csv` appears in the merge, and neither the audit trail nor the guest logs can show which session wrote it.
Options: (a) per-session guest audit (auditd) shipped off-box to an append-only store, correlated by Desktop Session id; (b) restrict to one rw session per Workspace and attribute the Workspace change to the lease holder; (c) accept with documented limits.
Recommendation: (b) as a minimum (it already exists via the write lease) and (a) for strict.
Challenges: Spec user story 12; plan §1 per-user guest login.

## Q11 [Impl] Workspace leases renewed by one process and held by idle desktops need fencing and expiry rules

The plan renews leases every 60 seconds from the BFF while a Session is active. If the renewing instance dies, the lease expires while the guest still writes; if the session is idle but connected, the write lease is held for days and blocks Jobs for the same Workspace. Sessions degrade to read-only when the writer lease is taken, which silently changes what the user can save.
Example: an engineer leaves a rw desktop connected over a weekend; Monday's scheduled Job waits 3600 s on the lease, then returns 409, and the scientist cannot tell why.
Options: (a) fencing tokens plus lease ownership by database and any instance may renew; (b) rw leases are held only while a gateway socket is connected, otherwise downgraded to ro with notice; (c) explicit lease timeout independent of session lifetime.
Recommendation: (a) with (b); notify the owner when the write lease is lost or downgraded.
Challenges: Plan §11a lease renewal every 60 s; Depends on 08.

## Q12 [Domain] Raw work lives in a mutable Workspace layer until merge, outside ALCOA "original" and "contemporaneous"

Edits made in a Desktop Session accumulate in the Workspace's changes and are not versioned, hashed or audited until a user commits or merges. GUI applications with autosave rewrite files many times. The merge by the maintain-role user is the review gate, but a reviewer sees only the final diff, not the history of edits that produced it.
Example: an analyst rewrites a data file 40 times over two days, deleting an outlier row on attempt 31; the merge diff shows only the final file and the reviewer cannot see that the row was removed.
Options: (a) record periodic automatic snapshots (Pins) of the Workspace upper layer on a safe branch while a session is attached; (b) require commits of raw data directly at acquisition and treat the Workspace as scratch; (c) accept the reviewer sees the final diff.
Recommendation: (a) for strict deployments, with snapshots kept under the repo's retention.
Challenges: Spec user story 12; cross-cutting "Merge+maintain is the review gate".

## Q13 [Impl] Quotas have no unit, no accounting model and a race in the existing cap

Only a count of concurrent sessions per user exists (default 2), and the check and the insert are separate steps, so two simultaneous creates can both pass. The spec asks for "quotas on session hours" without defining units (wall-clock, CPU-hours, per user, per namespace), how time is accumulated if the BFF crashes mid-session, or what happens at exhaustion.
Example: a user submits two create requests at the same millisecond with a cap of 2 and one existing session; both pass the count check and the user ends with 3 desktops.
Options: (a) database-enforced per-user concurrency with a unique or counted constraint, and hour accounting from provisioner state transitions in an append-only ledger; (b) quota enforced only monthly via usage reports; (c) leave to implementation.
Recommendation: (a), and the unit is wall-clock session-hours weighted by a template cost class.
Challenges: Spec user story 13 and "quota units are open"; New gap on the race.

## Q14 [Impl] Only a local Docker provisioner exists, but production deployment target (and thus the desktop substrate) is undecided

The Docker provisioner is a dev/E2E tool; libvirt and KubeVirt are stubs. A "Kubernetes" production would need KubeVirt (bare-metal or nested virtualization) or desktop pods, each with different isolation, mount and egress options. Egress via "Docker network or NetworkPolicy" and Workspace mounts as Docker volumes do not carry over to VMs.
Example: the organisation picks Kubernetes on a managed cloud without nested virtualization; KubeVirt is unavailable, and the only viable path is unprivileged desktop pods with different security properties than those the policy text assumes.
Options: (a) block this spec until the deployment decision and name one production provisioner; (b) desktop pods as the production substrate, VM provisioners dropped from scope; (c) keep Docker for single-host sites and design VM path later.
Recommendation: (b) if Kubernetes is chosen, (c) if Docker host; either way remove stubs from the "in scope" description.
Challenges: Spec "Provisioner" scope and Blocked-on in 00; plan Phase 2 stubs.

## Q15 [Domain] Template ownership, relaxation rights and desktop image change control are undefined

A "template owner" may relax clipboard and drive controls outside strict. Who is a template owner, how templates are approved, versioned and patched, and who is notified when a template changes are not defined. A desktop image is an OS plus applications; changing it changes the computerized system on which data is processed.
Example: a template owner enables clipboard for `lab-bio-desktop` on a Monday; Tuesday's analysis of a regulated dataset happens in a desktop with a changed policy and a newer image, and the change was not reviewed.
Options: (a) templates versioned and immutable once used; policy changes create a new template version and are audited with reason; (b) templates owned by instance admins only; (c) as decided.
Recommendation: (a) and (b) for strict; each Desktop Session records the template version and digest.
Challenges: Spec user stories 8 and 9; plan §11 template catalog.

## Q16 [Impl] Connect, disconnect and reconnect are gateway events observed by one process and subject to the strict rule

The BFF learns of a disconnect from the gateway socket it holds. If that instance dies, no disconnect is ever recorded, the idle timer never starts, and the session stays `connected`. Under strict every mutation fails closed on Intent append, but a disconnect is an observation, not a request that can be refused. Reconnect after a drop should mint a new ticket and be distinguishable from a new session.
Example: during an immudb outage under strict, a user's network blips; the disconnect cannot be recorded, so the BFF cannot reconcile the state, and 20 minutes later the user cannot reconnect because the session is "connected".
Options: (a) the gateway emits connection events to a durable queue consumed by any instance, with reconciler repair of stale `connected` states by polling the gateway; (b) status derived from the gateway's live connection list rather than stored; (c) only connect (the request) is gated by strict, disconnect is best-effort.
Recommendation: (c) as policy for observations with (b) for state, and an `observed` marker on events so auditors know the difference.
Challenges: Cross-cutting strict "ALL mutations"; spec user story 3 and 12.

## Q17 [Domain] Break-glass access to another user's desktop is undefined

Exclusive ownership has an exception: `session.admin` may list, stop, destroy and connect to any session. Entering someone's live desktop means seeing their unsaved data and acting in their guest account, but audit shows only an admin connect. There is no reason code, owner notification, dual control or marking of the actions as the admin's.
Example: an admin connects to a scientist's desktop to "fix a stuck app" and deletes a scratch results file; the guest account is the scientist's, and nothing records who acted.
Options: (a) admin connect requires a reason and a second approver, notifies the owner, and runs in a separate guest user; (b) admin may only stop or destroy, never connect; (c) as decided.
Recommendation: (b), and a separate admin-diagnostic desktop attached to the same read-only Workspace for investigations.
Challenges: Plan §7 `session_admin` break-glass; spec story 12.

## Q18 [Domain] Offboarding leaves a live desktop running with the offboarded user's identity

Offboarding is manual: an admin revokes the Principal by `iss`+`sub`. A running Desktop Session has a guest account, mounted Workspaces (possibly rw), a held lease and an open gateway connection. Revocation blocks new BFF requests but does not obviously disconnect an established RDP socket, nor release leases, nor stop the desktop; lifetime limits may be disabled (the default max lifetime is not stated).
Example: a contractor is revoked at 10:00 but their rw desktop stays connected until 22:00 and keeps editing a Workspace that a colleague wants to merge.
Options: (a) revocation terminates the Principal's gateway connections, stops their sessions (disk retained for handover) and releases leases; (b) revocation only blocks reconnect; (c) as decided with manual cleanup runbook.
Recommendation: (a), with a handover action that moves the stopped session's Workspace changes to the revoked user's manager or a repo admin.
Challenges: Cross-cutting "manual offboarding only; admin revoke is the group-revocation path".

## Q19 [Impl] Guest credentials are persisted in the session record and passed to the gateway

The session record holds a per-session guest password that the provisioner sets inside the guest and the connect path passes to the gateway. Storing a plaintext credential in the main database row, returned by internal reads and potentially copied into backups or logs, is a long-lived secret. The plan says "unique password from IdP email/sub", which is unclear: derived, random or stored.
Example: a database read-only role used by a reporting tool can read every active desktop's password; an auditor accessing a DB dump obtains guest passwords for 300 active sessions.
Options: (a) generate a random one-time credential per connect, set via the provisioner and never stored; (b) store encrypted with a KMS-held key; (c) passwordless guest auth with a gateway-held per-session secret that rotates.
Recommendation: (a); the record keeps only a credential id and an expiry.
Challenges: Plan §8 Phase 1 "per-user guest credentials"; New gap.

## Q20 [Impl] Whole-record read-modify-write makes lifecycle transitions lose updates

Session records are stored as one JSON body per row and updates read the record, merge a patch and write it back. Sweeper, user stop, retry, remount, lease renewal and the provisioner all patch the same record concurrently, across instances. There is no version check, so a late write can resurrect `ready` over `stopped` or drop a notice.
Example: the sweeper stops a session at the same time a user clicks Retry; the retry's write finishes last and sets `provisioning`, while the container was removed, leaving a record that never reaches `ready`.
Options: (a) a generation column with compare-and-set transitions and a defined state machine table; (b) row-level locks per transition; (c) event-sourced transitions.
Recommendation: (a), with explicit allowed transitions and each transition emitting an Intent/Outcome pair.
Challenges: Existing JSON-body store; cross-cutting multi-instance rule.

## Q21 [Domain] Data written outside mounted Workspaces is lost or unmanaged

The plan states that guest state outside mounts is documented as not surviving. Scientists will save files in the home directory, browser downloads and application caches. Destruction removes volumes. That creates scientific records in a place that is neither the system of record nor retained, which is a data integrity finding in an inspection.
Example: a user downloads instrument vendor output to the guest desktop, processes it, and the session is destroyed before they upload it; the original raw file is gone.
Options: (a) the guest home is a persistent per-user volume with its own retention and is included in recovery rules; (b) force all work paths onto mounts and block saving elsewhere in the desktop image; (c) as documented, with a warning at stop.
Recommendation: (b) for strict, (a) otherwise; either way tell users at connect time what survives.
Challenges: Plan §8 Phase 4 recovery item; retention forever.

## Q22 [Impl] Warnings and bounded extensions rely on Notifications, with duplicates and abuse paths

The spec has warnings before limits and an extension bounded by policy, delivered by 14. With all categories on by default, every user gets warnings on every tick unless deduplicated, and each instance's sweeper would emit its own. Extension is a mutation that must be audited and bounded, otherwise a user can chain extensions and defeat the lifetime limit.
Example: a user clicks "extend by 4 hours" six times; the max lifetime of 12 hours became 36 hours with no approval.
Options: (a) one extension per session with an absolute cap, approved by policy, deduplicated warning events keyed by session and threshold; (b) unlimited extensions, as long as the user is connected; (c) no extensions.
Recommendation: (a), with extension an audited Intent/Outcome mutation.
Challenges: Spec user story 5 and Phase 4 warnings; cross-cutting "all notification categories on by default".

## Q23 [Impl] An established RDP connection outlives the user's IdP session and Principal validity

A connect ticket is valid for 30 seconds, but the desktop stream stays open until the user disconnects. Back-channel logout, session expiry, PAT revocation and group removal affect only new HTTP requests. Under strict, a freshly authenticated user is expected for sensitive actions; a desktop connection kept open for 12 hours gives no re-authentication.
Example: a user's IdP session ends at 18:00 after a policy change to remove them from the project group, but the already-open desktop remains connected with write access until midnight.
Options: (a) bind gateway connections to the BFF session and terminate them on logout, revocation or expiry; (b) periodic re-validation every N minutes with forced disconnect; (c) accept as long as mounts are re-checked at the next connect.
Recommendation: (a) with (b) every 15 minutes in strict.
Challenges: Plan §7 "Connect re-checks every mount"; ADR 0001 revocation model.

## Q24 [Domain] The regulatory role of a Desktop Session is not defined

A Desktop Session might be a convenience environment for exploration or a controlled system in which GxP raw data is generated and decisions are made. The strict controls, recording and audit demands differ greatly. The plan defers regulated behaviour to "04 layers later", so strict-mode flags exist without a stated intended use, classification or validation approach.
Example: a QC lab uses a desktop to run the chromatography data system on a Workspace mount and treats outputs as primary records; QA then asks for the intended-use statement and the validation package, and none exists.
Options: (a) classify Desktop Sessions as "analysis and review only; no primary data capture" and state it in validation scope; (b) support primary capture and specify full controls (recording, snapshots, e-sig on merge); (c) leave to site SOPs.
Recommendation: (a) for this version, (b) as a later epic.
Challenges: Plan Out-of-Scope "GxP-strict product controls layered later"; spec Problem Statement.

## Q25 [Impl] The HTTP-boundary test seam cannot demonstrate that policies are actually enforced

The test decision says lifecycle and policy enforcement are tested over HTTP with connection parameters checked at the gateway boundary. That proves the BFF asks for clipboard off; it does not prove a desktop user cannot paste. Real xrdp desktops are heavy (minutes to provision, GBs of image) and cannot be exercised in normal parallel CI containers on every platform used by the team.
Example: a regression passes the HTTP suite while a gateway upgrade silently ignores the disable-copy parameter; production users can paste out.
Options: (a) protocol-level conformance tests with a scripted RDP/Guacamole client that attempts clipboard and drive channels against a real gateway, run nightly; (b) rely on gateway-boundary parameter assertions only; (c) manual validation at release.
Recommendation: (a) nightly plus (b) per PR, and record the gateway and image versions in the test evidence.
Challenges: Spec "Testing Decisions"; cross-cutting "tests at the BFF HTTP boundary".

## Q26 [Impl] Workspace mounts are Docker volumes; a VM or pod desktop on shared RWX cannot use them

Mounting uses Docker volumes of overlay trees with per-user uid mapping and re-verification of the change-set hash. On a multi-node cluster, the desktop runs wherever it is scheduled and mounts a Workspace via the shared filesystem; overlayfs on RWX is unresolved, and VM guests need a different mechanism (for instance virtiofs or NFS). The spec says only "depends on 08".
Example: on Kubernetes the desktop pod lands on node 4, the overlay mount fails with "invalid argument" on the RWX volume, and the session fails with no read-only fallback.
Options: (a) define a mount abstraction with `overlay`, `bind-ro` and `copy` drivers and an explicit degraded mode shown to the user; (b) restrict Sessions to read-only Workspace mounts until 08 resolves; (c) wait for the 08 spike.
Recommendation: (b) now, (a) as the 08 outcome lands.
Challenges: Spec cross-dependency on 08; plan §11a volume mount design.

## Q27 [Domain] Sessions and service principals: may automation create Desktop Sessions?

The plan lets a PAT create a Session (`via: pat`) and the platform now has service principals. A desktop is an interactive, human-operated environment with a per-user guest account and exclusive ownership. A service principal has no human to connect and no guest identity.
Example: a script with a PAT creates 2 desktops per night to run GUI-only legacy tooling, then nobody connects to them; the lifetime limit is the only cleanup.
Options: (a) PAT and service principals may create but never connect without a human Principal; (b) Desktop Sessions are human Sessions only; (c) as is.
Recommendation: (b); automation uses Jobs.
Challenges: Plan §5 `via`; cross-cutting "service principals in scope now".

## Q28 [Domain] Mounting several repositories of different sensitivity into one desktop

A Desktop Session can mount up to 8 Workspaces from different repos. Per-mount authorization is checked at create and connect, but combining a restricted repo (read) with an unrestricted repo (write) creates a copy path inside the guest that bypasses the reasons the restricted repo was access-controlled. Per-repo classification does not exist in the spec.
Example: a user mounts `clin/restricted-cohort` (ro) and `shared/scratch` (rw), copies a patient table across in the guest, and commits it to the broader repo.
Options: (a) repo-level "sensitivity" label; mixing labels in one desktop requires an exception or is blocked; (b) deny rw alongside restricted ro mounts; (c) rely on authz.
Recommendation: (a) blocking mixed sensitivity by default, with admin-approved exceptions.
Challenges: Plan §11a multi-mount; user story 7.

## Decisions log

| Q | Answer | Date |
| --- | --- | --- |
| Q1 | DB-leased sweeper, CAS transitions; idle from gateway events | answered |
| Q2 | Lifetime=>stop (disk kept N days), idle=>suspend, destroy only by user/admin; 15/5 min warnings, one extension | answered |
| Q3 | SUPERSEDED by Q4: recording never | answered |
| Q4 | RECORDING NEVER (owner; reverses 00 Q22). Compensating: one rw session/Workspace attribution + off-box auditd; Q4 storage design moot | answered |
| Q5 | Owner: treat desktop as inside the data boundary; rely on repo authz (no separate threat model) | answered |
| Q6 | Offer only gateway-enforceable policies; conformance test; guest lockdown | answered |
| Q7 | Stateless signed tickets; drain docs; reconnect grace | answered |
| Q8 | Named owner, pinned digests, SBOM, patch SLA; qualification entry criterion | answered |
| Q9 | Dedicated guest-facing oxen-data-path endpoint with session-scoped desktop principal | answered |
| Q10 | One rw session/Workspace + lease-holder attribution + off-box auditd correlated by session id | answered |
| Q11 | Inherited: 08 Q4/Q11 | answered |
| Q12 | Owner: require commits at acquisition (no auto snapshots); Workspace layer treated as non-record | answered |
| Q13 | As is (concurrent-create race remains — flagged) | answered |
| Q14 | Blocked on deployment decision; pods if K8s, Docker if single-host; drop libvirt/KubeVirt stubs | answered |
| Q15 | Versioned immutable templates, admin-owned, version+digest on session | answered |
| Q16 | Durable gateway event queue; reconciler polls; 'observed' marker; never fail-closed for observations | answered |
| Q17 | Inherited: no break-glass | answered |
| Q18 | Inherited: 01 Q20 revoke terminates Sessions | answered |
| Q19 | One-time per-connect guest credential, never stored | answered |
| Q20 | Generation column CAS + state machine table; Intent/Outcome per transition | answered |
| Q21 | As is (guest outside-mount data not preserved; documented) | answered |
| Q22 | One bounded extension, deduped warnings, audited | answered |
| Q23 | Inherited: 01 Q19/Q20 | answered |
| Q24 | Analysis/review only; no primary capture; stated in validation scope | answered |
| Q25 | Nightly protocol conformance + per-PR parameter assertions (recording tests dropped) | answered |
| Q26 | RO Workspace mounts until 08 spike; then mount abstraction | answered |
| Q27 | Inherited: no SPs | answered |
| Q28 | Sensitivity label; block mixing; deny rw+restricted ro; admin exceptions | answered |

---

# Known Issues and Conflicts

## Conflicts with Other Specs

1. **Recording mandate reversed (Q4)**: Overrides 00 Q22 and 04 Q22 (recording mandatory for GxP-touching Sessions). Compensating controls: one rw session/Workspace + off-box auditd. REGULATORY RISK: no primary capture, accepted by owner.

2. **Workspace layer non-record status (Q12, 08 Q2)**: Transient nature conflicts with ALCOA "original" and "contemporaneous". Commits required at acquisition, no auto-snapshots.

## Open Risks and Blockers

3. **Concurrent-create race (Q13)**: Remains "as is", flagged for implementation.

4. **Guest outside-mount data loss (Q21)**: Remains "as is", documented only.

5. **Deployment target dependency (Q14)**: Now resolved by 16 Q1 (Kubernetes). Pod provisioner is target, Docker dev-only.

6. **Workspace mount dependency (Q26)**: Depends on 08 spike (overlay-on-RWX). Fallback: copy/node-local scratch.

7. **Desktop threat model gap (Q5)**: No separate threat model; relies on repo authz (accepted risk).

8. **Revoke terminates Sessions (Q18, 01 Q20)**: Sessions terminated on revoke. No break-glass (Q17).

9. **Gateway qualification (Q8)**: Entry criterion for gateway qualification not yet scheduled. PENDING.

## Unresolved Design Decisions

10. **Auto-recovery scope**: Beyond `failed`/`stopped` transitions left open for implementation.

11. **Quota units**: Session hours quotas have undefined units (Q13).

12. **Idle timer measurement**: Spec says "from disconnect"; implementation needs gateway event-driven design (Q1).

# Impact on Other Specs

## Dependencies on Other Specs

- **08 (Workspaces)**: Q26 mount abstraction and overlay-on-RWX spike blocks production RW mounts
- **16 (Infrastructure)**: Q14 deployment target (Kubernetes) now resolved
- **01 (Authentication)**: Q18/Q20 revoke terminates Sessions; Q17 no break-glass
- **14 (Notifications)**: Q22 warnings and lifetime extensions rely on Notifications (dedupe needed)

## Impacts on Other Specs

- **02 (Authorization)**: Desktop principal needs session-scoped data-path endpoint (Q9)
- **03 (Audit)**: Q4 recording-never decision supersedes 00 Q22; compensating controls documented
- **04 (Signatures)**: Recording reversal affects validation scope (Q24: analysis/review only)
- **06 (Data Transfer)**: Q9 dedicated guest-facing BFF endpoint for Oxen data path
- **11 (Lineage)**: Desktop Session link for attribution (Q10, Q17)

## Cross-Cutting Concerns

- **Multi-instance coordination**: Q1 DB-leased sweeper with CAS; Q7 stateless signed tickets
- **Fail-closed strict mode**: Q16 gateway events (observations) never fail-closed
- **N BFF instances**: Q7 WebSocket state, gateway HA, drain semantics
- **Retention**: Q2 lifetime→stop (disk kept N days); Q21 outside-mount data not preserved

