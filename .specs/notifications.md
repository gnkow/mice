Status: needs-info
Blocked on: Q2 vs Q3 of 13 (favorites feeding notifications vs removal of the implicit-watch claim) must be resolved here; the recipient rules cannot be finalised until then.

# 14 — Notifications (PLAT-NOTIF)

## Problem Statement

Users must learn about events relevant to them (jobs, sessions, access, approvals, quotas) without noise, and must never see events they are not allowed to see.

## Solution

The recipient projection in PostgreSQL is authoritative; Novu is the delivery service only (supersedes the ADR 0004 "Novu owns state" wording). A notification worker projects audit events, resolving recipients by access and watch rules, with in-app inbox, email and optional channels; web push is deferred.

## User Stories

1. As a user, I want notifications for resources I can access by default, so that I need no setup.
2. As a user, I want to mute a resource or category, so that I control noise.
3. As a user, I want to disable a category globally, so that I opt out entirely.
4. As a user, I want the precedence of mute, override and category disable to be documented and consistent.
5. As an offline user, I want events delivered when I return, so that I miss nothing.
6. As a user, I want to be notified of my own job and session outcomes but not my routine edits.
7. As a user, I want inbox read state and counts, grouping and live updates.
8. As a user, I want email immediate or digest delivery, with quiet hours.
9. As a user who lost access to a resource, I want its notifications to stop revealing details.
10. As a workspace owner, I want lease contention (rate-limited), quota, failed commit and stuck-operation alerts.
11. As a user, I want own-account security alerts (new device, session revoked by an admin); these cannot be disabled.
12. As a reviewer, I want approval requests and reminders as the assigned reviewer, with no auto-escalation; any eligible maintainer may merge.
13. As an admin, I want a delivery-health view, so that failing channels are visible.
14. As a CLI user, I want `mice notifications`.

## Implementation Decisions

- Postgres holds the authoritative recipient projection; Novu (MongoDB, Redis) is delivery only. The worker is multi-instance safe with durable replay from audit; dedupe relies on the Novu transaction id (see Conflicts and open risks).
- Every catalog category is on by default; non-optional are own-account security events and approvals to the current approver.
- Rate limiting for lease-contention events; thresholds set in implementation.
- No escalation: the assigned reviewer is notified; on revoke, pending reviews are reassigned to namespace owners with notice and audit. Self-merge is forbidden.
- Optional channels (webhook, Slack, Teams) are later phases; web push deferred.
- Stuck-job recipients and subscription ownership: Notifications owns job event types; whether a per-job subscription is a favorite/watch is unresolved (13 Q2/Q3).

## Testing Decisions

- HTTP tests perform a mutation and assert the Novu-visible result for eligible and ineligible users.
- Prior art: existing notification worker tests on containers.

## Out of Scope

Escalation design (decided: none), webhook channels, web push, per-user cost controls.

## Further Notes

"All on by default" with non-optional own-account security and approval notices (Q3); everything else may be disabled.

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Authority and retention
- Recipient projection in Postgres authoritative; Novu delivers only; supersedes ADR 0004 wording (Q8).
- Notifications are non-records with 90-day content TTL in Novu and provider logs; delivery facts in audit (Q1).
- Dedupe via Novu transaction id (Q10).
- Ids and safe summaries in Novu; internal delivery dashboard; operator role (Q20).
- Pinned images, workflows as code verified at start, licence check (Q21).
- Lazy subscriber upsert; delete after revoke plus grace (Q22).

Channels and content
- Inbox on all; e-mail for personal and security; push opt-in (Q2); push deferred, generic text when enabled (Q14).
- Generic external content for restricted events and all push; detail in inbox only (Q9).
- E-mail only to verified IdP claims on a domain allow-list; else inbox only (Q13).
- Claim freshness check at dispatch; external delivery only to recently active Principals; offboarding SLA (Q12).
- BFF-built digests with permission recheck (Q15); per-recipient grouping after access filter (Q16).

Mandatory and approvals
- Non-optional: own-account security and approvals to the current approver (Q3).
- Assigned reviewer, no auto-escalation, any eligible maintainer may merge (Q4).
- On revoke, reassign pending reviews to namespace owners with notice and audit (Q5).
- Dispatch recorded for approval notices only; notifications are not evidence (Q26).
- Admin-wide audiences require a reason and audit (Q24).
- Read state exempt from audit; security/approval preference changes audited (Q25).

Operational alerts
- Notify on explicit Outcome events; inferred outcomes labelled unconfirmed with evidence (Q7).
- Wait-time threshold alerts, one per crossing, state in Postgres (Q17).
- Heartbeat-based stuck detection; user-configurable duration warnings; unresolved Intent events to admins (Q18).
- Rejection alerts outside the pipeline; hourly admin summary (Q19).

Delivery and testing
- p95 SLO per event class with recipient ceiling and CI load test (Q11).
- Decision table, generated tests, explain API (Q27).
- Pure scheduling function plus environment clock offset in test stacks (Q28).
- Poll plus cursor check backed by a Redis counter; streaming after load test (Q29).

## Conflicts and open risks

- Q10 RISK: owner overrode the recommended ledger; dedupe by Novu transaction id leaves a gap after long replays (window expiry) and conflicts with one-owner-per-fact, since the Postgres projection is authoritative.
- Q8: supersedes ADR 0004 and the glossary "Novu owns notification state"; both need updating.
- Unresolved link to 13 (Q2 vs Q3): favorites feeding notifications versus removal of the implicit-watch claim; this module must decide recipient rules.
- Q3 vs 13: favorite must not override non-optional categories or disabled categories.
- Q7: inferred outcomes (e.g. after crash with maintenance-window-only deploys, 16 Q27) may still produce unconfirmed notices.
- Q12/Q13: external delivery depends on IdP claim freshness and offboarding SLA; PATs and service principals are removed (Q23), so those recipient classes do not exist.
- Q1: 90-day TTL for notification content conflicts with any expectation of notifications as records; delivery facts live in immudb audit.
- Q29: polling first; streaming is deferred pending load test.

## Update from authentication review
- 14 Q22 IdP-migration subscriber cleanup is moot: IdP change is unsupported and iss+sub is never reused (auth Q29, Q80, S8).
- Recipient e-mail uses the IdP claim; bootstrap rules grant read-only baseline only (auth R1), so notification recipients follow actual grants.

---

# Open Questions


Status: needs-info; approval escalation, reviewer fallback and the mandatory-versus-preference rule are undecided, and the current code still carries a 90-day retention and a feed limited to the latest 500 messages per subscriber.
Biggest risks: notifications being the only trigger for the merge-and-sign review gate with no escalation, per-user visibility promises that Novu storage and external channels cannot honour, and a reconciler that can announce outcomes that did not happen.

## Q1 [Domain] Retention forever versus 90-day expiry: which statement is true for notification content?
The cross-cutting decision is that records are kept until deleted, with no expiry for logs, outputs, lineage or audit. The notifications plan requires deletion of content after 90 days and the code already enforces it. Notification payloads contain resource names, summaries and personal identifiers, and Novu keeps its own message and activity history in MongoDB. The owner needs one answer, because a privacy review will ask for it.
Example scenario: A user asks what the platform stored about them. The inbox is empty after 90 days, yet Novu's activity log and e-mail provider logs still show 14 months of subject lines.
Options:
- Notifications are transient with a fixed TTL across Novu and delivery logs — privacy-friendly, an exception to retain-forever.
- Keep everything as records — consistent, large personal-data store.
- TTL for content but keep metadata (who, when, category) — audit-friendly, partial.
Recommendation: Declare notifications non-records with a 90-day content TTL enforced in Novu, and keep delivery facts in audit.
Challenges: Cross-cutting "retention forever" versus plan "90 days".

## Q2 [Domain] What does "every category on by default" mean for e-mail and push?
The plan says inbox and toasts are enabled and e-mail and push are opt-in. The cross-cutting decision says every catalog category is on by default and does not mention channels. If the owner meant e-mail and web push too, every user starts receiving resource names by e-mail from day one, including to addresses not verified.
Example scenario: On launch, 800 users each receive about 40 e-mails a day for repositories they can read, and 25% of them mark the sender as spam within a week.
Options:
- Categories on, channel defaults per category (inbox on, e-mail only for personal outcomes) — balanced, needs a matrix.
- All channels on — maximum reach, noise and privacy exposure.
- Inbox only until the user opts in elsewhere — safest, risks missed alerts.
Recommendation: Inbox on for all categories; e-mail on only for personal and security categories; push opt-in.
Challenges: Cross-cutting "all notification categories on by default" and plan channel defaults.

## Q3 [Domain] Which notifications may a user never turn off?
The plan states no mandatory alerts, the spec leaves open whether security events can be disabled. If a user disables security notices, an admin revoke or an unfamiliar sign-in goes unnoticed; if approvals are disabled, a pending merge waits for a maintainer who opted out. Regulators expect that people responsible for an act are informed of it.
Example scenario: Maintainer Hugo disables the approvals category to reduce noise. A request to merge a validated dataset waits 9 days with no reaction.
Options:
- A short non-optional set (security of own account, approvals addressed to me, forced sign-off) — safe, contradicts "no bypass".
- Everything optional but with a banner and admin visibility of opted-out reviewers — preserves choice, weak control.
- Role-based: a notification duty attached to a role such as maintainer — aligns with accountability.
Recommendation: Define a non-optional minimal set limited to own-account security and approvals addressed to the current approver.
Challenges: Plan "Mandatory alerts: None" and the spec open item on mandatory versus preferences.

## Q4 [Domain] Is a notification an acceptable review trigger when merge plus maintain is the gate?
The decided gate is a merge by a maintain user who signs at merge, with no separate approver. There is no designated approval step, so the notice about a pending merge goes to whoever the platform determines "can review". That is potentially every maintainer, with no one accountable and no escalation target.
Example scenario: Pull request to merge "batch-2026-03" is opened; the notice goes to 14 maintainers across three teams; each assumes another will act and nothing is signed for 5 days.
Options:
- Require an assigned reviewer on each request, notices go to them, others see it passively — accountable, process change.
- Notify all maintainers and show who has claimed it — flexible, claim semantics needed.
- Escalate to namespace owners after a deadline — covers inactivity, needs the undecided escalation rules.
Recommendation: Assigned reviewer plus a deadline-based escalation to namespace owners, decided before implementation.
Challenges: "Merge+maintain is the review gate", spec blocker on escalation, plan Q17.

## Q5 [Domain] Who covers a reviewer who has been offboarded manually?
Offboarding is manual by iss+sub revoke, with no directory sync. A reviewer who left stays eligible until an admin acts, and pending approvals assigned to that person stall. The offboarded-reviewer fallback is undecided and blocks escalation.
Example scenario: Reviewer Karin left on 1 March; the admin revokes her on 12 March; 6 merge requests assigned to her wait in the meantime and one is a release for an audit.
Options:
- Fallback to the namespace owners at revoke time and reassign pending items automatically — fast, needs owner presence.
- Notify the admin who revoked to reassign each item — explicit, manual.
- Leave items stuck and surface in a dashboard — passive, risky.
Recommendation: On revoke, list the principal's pending reviews and reassign to namespace owners with a notification and an audit event.
Challenges: Spec blocker "offboarded-reviewer fallback undecided" and cross-cutting "manual offboarding only".

## Q6 [Domain] Does separation of duties hold when the author can be the signer?
E-signature happens when a maintain user merges. If the author also holds maintain rights, the notification chain tells the same person to approve their own change. Without a rule excluding the author, the review gate can be a formality.
Example scenario: Scientist Pavel has maintain on his own repository, opens a merge request and receives "approval requested" for it, merging it 30 seconds later.
Options:
- Exclude the requester from approver notifications and from signing — standard GxP practice, may deadlock small teams.
- Allow self-approval with a flag in audit and a configurable per-namespace policy — flexible, weakens control.
- Require two distinct people only for regulated namespaces — risk based.
Recommendation: Exclude requesters for regulated namespaces and make the policy visible in the notice.
Challenges: Cross-cutting "e-sig = maintain user signs at merge, no separate approver".

## Q7 [Impl] Can the projection decide whether an event really happened, given the reconciler infers outcomes?
The worker projects audit events into Novu, and the reconciler appends inferred Outcome events by re-querying oxen. A notification fired from an Intent would be false if the mutation failed; one fired from an inferred Outcome may be wrong if oxen state is ambiguous (another user's identical change, a force push). Users are told "your merge failed" or "succeeded" on inference.
Example scenario: A merge crashes midway; the reconciler sees a matching head and appends "success" at 10:07, but a colleague's merge produced the same head at 10:05. The wrong person is told it succeeded.
Options:
- Notify only on explicit Outcome events and mark reconciler-inferred ones as "unconfirmed" — honest, delayed.
- Notify on Intent with a "pending" notice and update later — fast, noisy.
- Suppress notifications for inferred outcomes — safe, users see nothing.
Recommendation: Notify on explicit outcomes immediately and on inferred ones with an "unconfirmed" label and the evidence used.
Challenges: Cross-cutting reconciler decision and plan "ambiguous outcomes must not become invented successful events".

## Q8 [Impl] What guarantees do inbox reads, counts and filtering have when Novu holds the state?
The plan requires permission rechecks on every inbox, count, group and deep-link read. Novu returns messages in pages and the current client fetches up to five pages of 100, so a user with more than 500 messages sees only the newest. Filtering after fetching breaks page sizes and unread counts: Novu's count includes items the user may no longer see.
Example scenario: A user with 1,200 messages has 300 unread; 80 are for a repository she lost. The bell shows 300, the filtered list shows 220, and a "mark all read" call reports success on 300.
Options:
- Store inbox projections in the Main database with Novu used for delivery only — full control, contradicts "Novu owns state".
- Keep Novu as source and compute counts in the BFF by scanning — correct, slow.
- Tag each message with the resource id and ACL version and filter in the BFF with over-fetch — practical, unstable pagination.
Recommendation: Keep recipient-level projections in PostgreSQL with the authoritative read state, and use Novu for channel delivery; reconsider "Novu owns state".
Challenges: Glossary "Notification service: Novu owns notification state" and plan section 8.

## Q9 [Domain] What exactly is hidden when a user loses access, given content already left the platform?
Revoked access hides notifications and removes them from counts, but the e-mail, push message and Novu stored payload already contain the resource name. Plan acknowledges delivered mail cannot be recalled. The user can also keep a notification's deep-link text.
Example scenario: A contractor receives e-mail "Job 'LNP-liposome-run-5' failed in 'acme/oncology-7'" on a personal address and stays free to forward it after revoke.
Options:
- Generic external content ("A job failed, sign in to view") — leaks nothing, less useful.
- Names for internal-domain recipients only — compromise, unreliable domain trust.
- Names allowed with a documented risk acceptance — convenient.
Recommendation: Generic external payloads for restricted namespaces and for all push; full detail only in the inbox.
Challenges: Plan "External payload: resource names and event summaries allowed" and story 9.

## Q10 [Impl] How does the worker stay idempotent and single-processing across N BFF instances?
The projection must be multi-instance safe with durable replay from audit. Novu deduplicates by a transaction id only for a limited window, so a replay after a long gap may create duplicates. Two instances can also consume the same audit range unless a lease and a cursor are stored.
Example scenario: Instance B restarts after 3 hours and replays 5,000 events from its saved cursor; Novu's dedupe window of a few minutes has passed and users receive duplicate inbox messages.
Options:
- Own delivery ledger keyed by event and recipient in the Main database, checked before every trigger — exact, extra table.
- Rely on the Novu transaction id — simple, bounded window.
- Single leader instance for the worker via a database lease — easy semantics, failover delay.
Recommendation: Ledger in the Main database with a lease-held consumer and a durable audit cursor.
Challenges: Plan "worker is idempotent and multi-instance safe, with durable replay from audit".

## Q11 [Impl] How is the 30-second latency target measured with polling and a three-hop pipeline?
Audit append, worker pickup, Novu workflow and a 10-second client poll each add delay, and the load assumptions (users, events per second, fan-out) were never stated. A healthy-system target without a load model is not verifiable.
Example scenario: A merge into a repository readable by 2,000 users generates 2,000 inbox messages; the Novu trigger rate limits at 50 per second and the last user waits 40 seconds.
Options:
- Define a percentile SLO (p95 under 30 s for up to 500 recipients) with a load profile — testable.
- Switch to bulk triggers and topics per repository — fewer calls, access filtering complexity.
- Drop a numeric target, document best effort — honest, hard to validate.
Recommendation: p95 targets per event class with a stated recipient ceiling and a load test in CI containers.
Challenges: Plan open question 2 and the 30-second requirement.

## Q12 [Domain] Who still receives notices for a Principal that was not revoked after leaving?
Recipients are computed from current access, and offboarding is manual. Between leaving and the revoke, the person continues to receive events, including e-mail to a personal address stored in claims. Group-based access relies on claims saved from earlier logins, which can be stale for offline users.
Example scenario: Chemist Lars left on Friday; the admin acts on Wednesday. Lars's mailbox receives five notices naming stability studies.
Options:
- Treat IdP deactivation as a signal through a periodic user-info check at dispatch time — closes gap, needs IdP calls.
- Accept the window and document an offboarding SLA — simple, process-bound.
- Short validity for saved group claims, notifications to unverified principals are inbox only — conservative.
Recommendation: Check claim freshness at dispatch and send external notices only for principals seen recently; document the offboarding SLA.
Challenges: Cross-cutting "manual offboarding only (no SCIM)" and plan question 4.

## Q13 [Domain] Which e-mail address may receive notices and how is it trusted?
The identity is iss+sub and the e-mail comes from IdP claims. IdPs differ in whether an e-mail is verified, can be changed by the user, or is shared. Sending names of regulated resources to an unverified address is a disclosure risk.
Example scenario: A user changes the e-mail claim at a self-service IdP to a personal address and starts receiving notices for resources from the work account.
Options:
- Only verified IdP claims accepted, otherwise inbox only — safe, depends on the IdP.
- Platform-managed address verification with a link — independent, more flows.
- Admin-managed allow-list of domains — practical, rigid.
Recommendation: Use verified claims plus a domain allow-list; otherwise inbox only.
Challenges: Plan open question 3 (external e-mail sender and verification).

## Q14 [Domain] Are Web Push and e-mail through external providers acceptable for GxP-related names?
Web Push travels through the browser vendors' push services, and SMTP through whichever relay is configured. Deployment target is undecided, so HTTPS and VAPID readiness is unknown, and supplier assessment for these processors is needed.
Example scenario: A push message with job name "Study-42 batch release" is delivered through a vendor's push service outside the EU, which the DPO's list of processors does not contain.
Options:
- Generic push text only — meets most privacy needs.
- Disable push until the deployment target is chosen — defers, loses channel.
- Self-hosted relay for mail with a documented processor list — controlled.
Recommendation: Defer push until the target is known and send generic text only when enabled.
Challenges: Plan channels list and "deploy target undecided".

## Q15 [Impl] Can Novu implement quiet hours, digests and DST-correct schedules or must the BFF?
Digest and delay steps exist in Novu, but a digest assembled by Novu holds payloads captured at trigger time and cannot recheck permissions at assembly, which the plan requires. Time zones, DST jumps and weekly schedules across users add edge cases.
Example scenario: A weekly digest at Monday 09:00 for a user in Europe/Berlin includes a repository where the user's access was removed on Sunday; the digest was assembled from trigger-time payloads.
Options:
- Build digests in the BFF from the projection with a permission check at assembly, Novu only transports — correct, more code.
- Use Novu digest and accept stale payloads with generic text — less code, weaker.
- Immediate-only e-mail — simple, no digest feature.
Recommendation: BFF-built digests with permission recheck.
Challenges: Plan sections on quiet hours/digests and "Recheck permissions when assembling".

## Q16 [Impl] How are bursts grouped without crossing permission boundaries?
Grouping bursts must not merge events that recipients are allowed to see differently, and new activity must reappear unread. Novu offers digest, while the plan wants constituent events kept. A grouped item that mixes a restricted and an unrestricted event can leak a count.
Example scenario: Fifty file changes in one push appear as one group; for a user with access to only 30 paths the group says "50 files changed".
Options:
- Group by (recipient, resource scope, category) after the access filter — correct, per-recipient groups.
- Group globally and filter at read — cheaper, leaky counts.
- Do not group, only paginate — simple, noisy.
Recommendation: Per-recipient grouping after the access filter, constituents retained.
Challenges: Plan section 6 grouping and user story 7.

## Q17 [Domain] What are the rate limits and ownership of lease-contention alerts?
Spec asks for lease contention alerts to workspace owners, rate limited, thresholds set in implementation. Without a definition of ownership and thresholds, owners are paged for normal queueing, and rate-limit state sits in some store.
Example scenario: A shared Workspace sees 30 lease contentions an hour from a nightly pipeline; the owner receives 30 alerts and mutes the category, missing a real deadlock.
Options:
- Aggregate to one alert per workspace per hour with a count — less noise, delayed.
- Alert only when contention exceeds a wait time — signal over noise.
- Make alerts opt-in — quiet, may miss.
Recommendation: Alert on wait time thresholds with one notice per crossing and persisted state in the Main database.
Challenges: Spec story 10 and "thresholds set in implementation".

## Q18 [Domain] How is "stuck" defined for Jobs, Desktop Sessions and unresolved Intent events?
Stuck-operation alerts are in the spec; no automatic job retries exist, and the reconciler resolves orphaned Intents. A long scientific job is legitimate, and notifying owners about an Intent with no Outcome exposes platform internals.
Example scenario: A 14-hour simulation job is flagged as stuck at 6 hours; the user cancels it and loses a day of compute.
Options:
- Per-job-type thresholds set by the submitter with an instance default — flexible.
- Flag only absent heartbeats, not duration — precise, requires heartbeat in runners.
- Notify admins only — less user noise, less ownership.
Recommendation: Heartbeat-based stuck detection, duration warnings user-configurable, and unresolved-Intent alerts to admins only.
Challenges: Spec story 10 and plan section 4 operations.

## Q19 [Domain] What do security alerts reveal and who can be flooded by them?
New-device alerts need IP and location data; admin alerts on cross-site and unclassifiable-write rejections are triggered by external actors, so an attacker can flood admin inboxes or Novu and cause notification costs. The admin revoke notice might name the acting admin.
Example scenario: A bot sends 20,000 cross-site POSTs to the BFF; the alert stream produces 20,000 events and exhausts the Novu rate budget, delaying approvals for everyone.
Options:
- Aggregate and cap security alerts with a separate budget and queue — resilient.
- Log only, no notification for rejection events — safe, less visibility.
- Alert on thresholds from a security monitor outside notifications — separation of concerns.
Recommendation: Keep rejection alerts out of the notification pipeline; send an aggregated hourly summary to admins.
Challenges: Plan security (proposed) rows and story 11.

## Q20 [Impl] Who can read all notifications through Novu's own interfaces?
Novu stores payloads in MongoDB and has its own dashboard and API. The BFF currently logs in with a stored e-mail and password. Anyone with Novu access, or database access, can read every user's notices, which contradicts per-user visibility, and the delivery-health view must not show content.
Example scenario: An operator opens the Novu dashboard to debug and sees 14,000 messages naming restricted repositories.
Options:
- Restrict Novu to the internal network, remove default users, separate operator role without payload access — operational control.
- Store minimal payloads (ids only) and render at read time — strongest, requires the BFF in the read path.
- Encrypt payload fields — middle ground, key management.
Recommendation: Ids plus safe summaries in Novu, no dashboard exposure, and a documented operator role.
Challenges: ADR 0004 Novu as notification owner and plan section 8 health view.

## Q21 [Impl] Are the Novu edition, licence and version fit for a validated deployment?
The stack grows by Novu, MongoDB and Redis. Self-hosted editions limit some features, workflows are defined in Novu rather than code, and upgrades change behaviour. There is no stated procedure for pinning and revalidating.
Example scenario: A Novu update changes digest semantics; a regression test passes in CI but the production workflow definition is out of sync with code.
Options:
- Version-pinned images and workflow definitions stored as code and synced at start — reproducible.
- Use Novu only for in-app and keep e-mail outside it — smaller surface.
- Replace with a simpler in-house queue — contradicts ADR 0004.
Recommendation: Pin images, keep workflow definitions in code and verify on startup, and check the self-hosted licence terms.
Challenges: ADR 0004 and cross-cutting persistence decisions.

## Q22 [Impl] How are subscribers created, keyed and removed for each Principal?
Subscribers are identified by iss+sub in Novu. The lifecycle for revoked Principals, IdP migration and service principals is unspecified, and deletion of a subscriber removes messages that might be needed as evidence of notification.
Example scenario: After an IdP migration, 600 new subscribers are created, and old ones keep receiving triggers because the worker resolves recipients from stale directory rows.
Options:
- Subscriber upsert on first sight and deletion on revoke after an export — controlled.
- Keep subscribers forever — simple, personal-data accumulation.
- Subscribers created lazily at delivery — minimal, first-event latency.
Recommendation: Lazy upsert, delete after revoke plus grace period.
Challenges: Glossary Notification service and cross-cutting identity decisions.

## Q23 [Domain] How do service principals learn about failures of their automation?
Service principals are in scope; they have no inbox or e-mail. Outcomes of automation jobs go to whoever owns the principal, which is undefined, and the optional webhook channel is deferred.
Example scenario: A nightly ingest run by service principal "svc-ingest" fails for 6 nights; no human is notified because the principal has no recipient.
Options:
- Each service principal has a named owner who receives its notices — accountable.
- Failures appear only in audit and a status page — passive.
- Webhook channel promoted to scope — active, SSRF and secrets work.
Recommendation: Require an owner on every service principal and route its personal outcomes to that owner.
Challenges: "Service principals in scope now" and "optional channels deferred".

## Q24 [Domain] How can announcements be audience-targeted only and still cover an incident?
Announcements are decided as audience-targeted only, never to everyone. An outage, data incident or security advisory needs to reach every user, and audience definitions rely on groups from saved claims that may be stale. Announcements also act as a de facto mandatory category.
Example scenario: A security incident requires notifying all 900 users; the admin must create 40 audiences and one is missed.
Options:
- Add an instance-wide audience restricted to admins with audit and a reason — practical.
- Keep targeted only and publish incident notices outside the platform — reliable, off-system.
- Targeted with a "all principals seen in 90 days" helper — flexible.
Recommendation: Permit an instance-wide audience for admins with a mandatory reason and audit.
Challenges: Cross-cutting "announcements audience-targeted only".

## Q25 [Impl] Where do preferences live, and is changing them a strict-mode mutation?
Preferences and read states are changed constantly, and the plan accepts last-save-wins. Under strict mode every mutation needs an Intent event in immudb, so a preference save or mark-read becomes a 503 during an audit outage and a flood of events otherwise.
Example scenario: immudb is unavailable; 300 users cannot mark notices read or mute a repository, and the inbox badge climbs.
Options:
- Exempt preferences and read state with a documented rationale — practical, another exception.
- Audit only preference changes of non-optional categories — targeted.
- Audit everything — uniform, heavy.
Recommendation: Exempt read state, audit changes to security and approval preferences.
Challenges: Cross-cutting "GXP_STRICT fail-closed for ALL mutations".

## Q26 [Domain] Is the sending of a notice itself evidence an auditor can ask for?
Auditors may ask whether a reviewer was told of a request and when. Delivery is at least once with provider acceptance not equal to delivery, and notifications expire. If approval timeliness is evidenced by notices, the platform needs a durable record of dispatch.
Example scenario: An inspector asks to see proof that the maintainer was notified of the release request on 3 March; Novu content expired and e-mail logs are at the provider.
Options:
- Audit events for dispatch of approval and security notices — evidence, volume.
- Declare notices non-evidence; rely on request timestamps — honest, easier.
- Store dispatch receipts in the Main database — queryable, parallel record.
Recommendation: Declare notifications non-evidence in the validation plan and record dispatch only for approval notices.
Challenges: Plan statement "notifications are not a replacement for audit".

## Q27 [Impl] What is the exact precedence of global, category, channel, resource mute, watch and personal relevance?
The plan lists precedence rules in prose, and the spec asks that they be documented and consistent. Per-job subscription is a favorite or watch, favorites never bypass categories, personal outcomes bypass resource mutes. A matrix of these decides recipients and must be testable.
Example scenario: User mutes repository "acme/data", stars job J-9 inside it, has e-mail digests for jobs, and the job fails. Does she receive the inbox item, the e-mail, both or none?
Options:
- A single decision table in the spec with generated tests — verifiable.
- Prose rules only — flexible, ambiguous.
- Evaluate in an ordered rule engine with explain output — debuggable, more code.
Recommendation: Decision table with an "explain" API returning why a notice was or was not delivered.
Challenges: Spec story 4 and plan section 5.

## Q28 [Impl] How are time-dependent and external-channel behaviours tested at the HTTP boundary?
Tests are black-box against real containers. Digests, quiet hours, DST and retries depend on time; e-mail and push need doubles; Novu workflows are asynchronous; and two worker instances need duplicate-prevention checks.
Example scenario: A test for a weekly digest across a DST change must wait a week unless the clock is controllable.
Options:
- A server-side test clock settable through an authenticated test endpoint — fast, adds a surface that must be disabled in production.
- Make schedule computation a pure function with exhaustive tests, and run only smoke tests at the boundary — cheap, partial.
- Real waiting for short schedules in CI — slow.
Recommendation: Pure scheduling function plus a clock offset configured via environment in test stacks only.
Challenges: Cross-cutting testing decision.

## Q29 [Impl] How do the CLI watch command and the live stream scale across instances?
The UI polls every ten seconds and the CLI watch may poll or stream. A polled count and a permission-filtered list per user per ten seconds becomes thousands of Novu requests and authorization checks, and a streaming endpoint needs sticky routing or a shared pub/sub across N instances.
Example scenario: 1,500 open tabs poll every 10 seconds; each request triggers a Novu call plus an authorization recheck, giving 150 requests a second.
Options:
- Server-sent events backed by Redis pub/sub and a cursor — efficient, more infrastructure use.
- Poll with ETags and a cheap cursor check — simple, still many requests.
- Increase poll intervals for background tabs — pragmatic.
Recommendation: Poll with a cursor check backed by a counter in Redis, and decide on streaming after load measurements.
Challenges: Plan "Poll every 10 seconds" and the CLI scope proposal.

## Decisions log

| Q | Answer | Date |
| --- | --- | --- |
| Q1 | Non-records, 90-day content TTL (Novu + provider logs); delivery facts in audit | answered |
| Q2 | Inbox on all; e-mail personal+security; push opt-in | answered |
| Q3 | Non-optional: own-account security + approvals to current approver | answered |
| Q4 | Assigned reviewer; no auto-escalation; any eligible maintainer may merge | answered |
| Q5 | On revoke reassign pending reviews to namespace owners, notice + audit | answered |
| Q6 | Inherited: self-merge forbidden (04/05) | answered |
| Q7 | Notify on explicit Outcomes; inferred labelled unconfirmed + evidence | answered |
| Q8 | Recipient projection in Postgres authoritative; Novu delivery only (supersedes ADR 0004 wording) | answered |
| Q9 | Generic external content for restricted + all push; detail inbox only | answered |
| Q10 | Rely on Novu transaction id (OWNER OVERRODE ledger recommendation; dedupe window gap after long replay = known RISK) | answered |
| Q11 | p95 SLO per event class with recipient ceiling + CI load test | answered |
| Q12 | Claim freshness check at dispatch; external only recent principals; offboarding SLA | answered |
| Q13 | Verified IdP claims + domain allow-list; else inbox only | answered |
| Q14 | Push deferred; generic text when enabled | answered |
| Q15 | BFF-built digests with permission recheck | answered |
| Q16 | Per-recipient grouping after access filter | answered |
| Q17 | Wait-time threshold alerts, one per crossing, state in Postgres | answered |
| Q18 | Heartbeat-based stuck detection; user-configurable duration warnings; unresolved-Intent to admins | answered |
| Q19 | Rejection alerts outside pipeline; hourly admin summary | answered |
| Q20 | Ids + safe summaries in Novu; internal dashboard; operator role | answered |
| Q21 | Pinned images, workflows as code verified at start, licence check | answered |
| Q22 | Lazy upsert; delete after revoke + grace | answered |
| Q23 | Inherited: service principals removed | answered |
| Q24 | Instance-wide audience for admins with reason + audit | answered |
| Q25 | Exempt read state; audit security/approval pref changes | answered |
| Q26 | Non-evidence; dispatch recorded for approval notices only | answered |
| Q27 | Decision table + generated tests + explain API | answered |
| Q28 | Pure scheduling fn + env clock offset in test stacks | answered |
| Q29 | Poll + cursor check backed by Redis counter; streaming after load test | answered |

---

# Known Issues and Conflicts

_To be documented: Known blockers, conflicts with other specs, and unresolved design questions._

# Impact on Other Specs

_To be documented: Dependencies, blocking relationships, and cross-cutting concerns._

