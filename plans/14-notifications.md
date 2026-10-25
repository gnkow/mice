# MICE notifications - design and delivery plan

> **Storage update (ADR 0004/0005):** this plan was written for JSON/JSONL files under `AUTH_DATA_DIR`. Those stores are now PostgreSQL, immudb (audit) and Novu (notifications); file names and file-based mechanics below are historical. See [16-operations.md](./16-operations.md) section 2.3.

Status: single-instance implementation delivered. Deployment scope revised by the user to a
single auth instance; shared database/multi-instance migrations are out of scope.

Implemented: durable inbox and delivery queue, audit replay, all event categories,
profile preferences, hierarchical overrides, online toasts, SMTP immediate/digest
delivery, Web Push, quiet hours, permission filtering, grouping, and retention.
Daily/weekly digests use 09:00 / Monday 09:00 in the profile timezone, deferred
until quiet hours end when necessary.

Current limits: no announcement-authoring UI (admin API is available); deleted
resource notices are conservatively hidden; offline IdP groups are bounded saved
claims, not synchronized directory state. Replay suppresses general fan-out when
later observed access mutations prevent reconstruction of historical access.
Preferences use last-save-wins rather than cross-device optimistic concurrency.
Production capacity/SLO, external email sender/verification policy, and browser
support must be assessed against the deployment. External provider delivery is
at least once; successful core mutation and audit append are not transactional.

Related: [01-authentication.md](./01-authentication.md), [02-authorization.md](./02-authorization.md),
[03-audit.md](./03-audit.md), [09-jobs.md](./09-jobs.md), [10-sessions.md](./10-sessions.md),
[12-metadata-search.md](./12-metadata-search.md).

## 1. Outcome

Notify each user about events affecting them personally and resources they can
access. Provide an in-app inbox, online toasts, email, and browser/desktop push.
Users manage all notification preferences from their profile.

Notifications are a user-facing product, not a replacement for the audit log.
Audit visibility must not be required to receive an otherwise authorized notice.

## 2. Confirmed requirements

| Area | Decision |
| --- | --- |
| Resource coverage | All accessible resources by default, with per-resource mute controls |
| Personal relevance | Own job/session outcomes, access changes, and requests the user can approve |
| Own actions | Exclude routine self-generated edits; include relevant asynchronous outcomes |
| Channels | Inbox, online toast, email, browser/desktop push |
| Channel defaults | Inbox and online toasts enabled; email and push opt-in |
| Profile controls | Global enable/disable, event categories, channels per category, resource watch/mute, email digests, quiet hours, timezone |
| Mute hierarchy | Parent mute includes descendants; explicit child overrides allowed |
| Personal notices | Separate from resource muting, but subject to global/category/channel preferences |
| Email digests | Immediate, daily, or weekly |
| Quiet hours | Inbox updates immediately; defer email, push, and toasts |
| Mandatory alerts | None; no category bypasses user preferences |
| Inbox controls | Mark read/unread and mark all read |
| Noise reduction | Group bursts without losing underlying events |
| Retention | 90 days |
| Latency | Eligible immediate notifications within 30 seconds under healthy operation |
| Access revocation | Immediately hide resource notifications; retain a minimal personal access-change notice |
| External payload | Resource names and event summaries allowed; no file contents or secrets |
| Event boundary | Only changes observed by MICE; direct Oxen/IdP changes excluded initially |
| Deployment | Single auth instance; durable local state and restart recovery |

The 30-second target excludes configured quiet hours, digest scheduling, provider
outages, and browser/OS delivery delays. Measure inbox availability, dispatch
latency, and provider acceptance separately; acceptance is not proof of delivery.

## 3. Current integration surfaces

- `auth/src/audit.ts`, `proxy.ts`, `auditMutation.ts`, and `app.ts`: existing attributed
  mutation events and BFF entry points. Audit classifications are useful input, not a
  complete or reliable notification queue.
- `auth/src/jobs.ts` and `sessions.ts`: asynchronous lifecycle transitions.
- `auth/src/metaRoutes.ts`: tag/label changes.
- `auth/src/accessRequests.ts`, AuthZ routes/stores, and `tokens.ts`: personal
  access, approval, membership, role, and token events.
- `auth/src/authzTypes.ts`: user identity is issuer plus subject, not email;
  access can be granted directly or through groups.
- `web/src/components/Layout.tsx`: existing profile-menu integration point.
  `web/src/pages/SettingsPage.tsx` currently mixes user and instance settings.
  Add a clearly user-scoped Profile > Notifications surface.
- `compose.yaml`: currently no shared notification database/queue service.
  Existing file-backed stores do not establish safe multi-instance operation.

## 4. Event catalog and recipient policy

Define typed domain events with explicit recipient and permission rules before
implementing producers. Successful state transitions, not HTTP requests alone,
are the notification boundary. Retries and background transitions count too.

| Category | Events | Recipient policy |
| --- | --- | --- |
| Access | Request submitted, approved, rejected; membership/role/access changed | Requester or affected user; pending requests also go to users currently authorized to review that request |
| Jobs | Completed, failed, cancelled | Submitter as a personal outcome; other eligible resource readers subject to job-specific permissions |
| Desktop sessions | Ready, failed, expired | Owner as a personal outcome; other recipients only where session visibility permits |
| Repositories/branches | Created, deleted, commit published, merged | Eligible readers of the affected resource, excluding routine actor echoes |
| Files/folders | Created, changed, deleted | Eligible readers; group bulk writes/pushes into useful summaries |
| Metadata | Tag/label additions, edits, removals | Users authorized to see the annotated resource and scope |
| Security | User-affecting token lifecycle changes | Affected user only; never include token values |
| Security (proposed) | PAT expiring soon (e.g. 14/3 days) and expired; last-used is tracked and may inform the notice | Token owner only; name, scopes and expiry date, never the `mice_pat_*` value |
| Security (proposed) | Session revoked by an instance admin (the same cut-off also rejects the target's PATs issued before it) | Affected Principal only; say Sessions and PATs were cut off, not who among admins acted unless policy allows |
| Security (proposed) | Sign-in from a new device or location | Signed-in user only; coarse device/location summary, no IP or token detail in external channels |
| Security (proposed, admin) | CSRF cross-site rejections (`request.cross_site_rejected`) and rejected unclassifiable writes that author injection fails closed on (`request.rejected`, ADR 0001) | Instance admins only, as a rate-limited/grouped summary; never include request bodies, cookies, headers or token values |
| Approvals (proposed) | Review/approval requested (GxP e-signature, merge approval), reminder, escalation, decided | Designated approvers; requester gets the outcome; escalation target defined by policy |
| Operations (proposed) | Job or Desktop Session stuck/long-running; quota warnings | Owner as a personal outcome; admins for instance-wide thresholds |
| Announcements | Instance maintenance and administrator announcements | Explicit authorized audience; only authorized administrators can publish |

Security notices never contain token values, Session cookies or secrets. Admin-only
security alerts go to instance admins, not to namespace owners or resource readers.

Repository readability alone does not imply visibility of private sessions,
access requests, token events, or administrative details. Use the same effective
capabilities as the corresponding product APIs.

Personal outcomes and resource activity can overlap: produce one logical inbox
notification per user/event, with relevance reasons rather than duplicate rows.
Cross-repository events need an explicit safe rendering policy for each resource;
never infer access to one resource from access to another.

## 5. Eligibility, hierarchy, and access changes

1. Identify known users by `(iss, sub)` and resolve direct/group effective access
   using shared, current authorization state.
2. Determine personal relevance and/or permission to observe the resource event.
   Resource activity requires access at event time; newly granted access must not
   backfill historical activity automatically.
3. Exclude routine self-actions, while retaining personal lifecycle outcomes.
4. Apply global enablement, category preferences, resource overrides, and channel
   choices. Personal relevance bypasses resource mutes only, not user preferences.
5. Apply channel availability, consent, quiet hours, and email digest schedule.
6. Recheck current access and preferences before external dispatch and every
   inbox/count/group/deep-link read.

Proposed hierarchy: instance > namespace > repository > typed descendant.
Define explicit identities for branch, commit, path/scope, workspace, job, and
session resources. A file's metadata scope is not an inherited notification
preference. Branches/commits form a graph, not a simple parent tree: document a
canonical notification ancestry and do not duplicate shared-commit events.

The nearest explicit resource override wins. An explicit watch can override a
parent mute, but cannot grant access, override a global/category disable, or
silently enable an external channel. Show the inherited effective setting.

Revoked access hides affected entries and removes them from counts and summaries;
cancel queued external delivery. Preserve only a minimal personal access-change
notice without restricted resource details. Previously delivered email/push
cannot be recalled; explain this limitation in privacy documentation.

Deletion needs a separate policy: distinguish deletion from revoked access using
authorized tombstone metadata. Until that policy is agreed, do not expose deleted
resource names merely because an old notification contains them.

## 6. Profile and inbox UX

- Profile > Notifications: global switch, category/channel matrix, immediate vs
  daily/weekly email, timezone, quiet hours, resource overrides, and delivery status.
- Explain missing administrator email/push configuration without discarding saved
  preferences. Request browser permission only after a user action.
- Header bell with unread count and inbox link; keyboard-accessible inbox with
  filters, timestamps, event summaries, resource links, read/unread, and mark all read.
- Clicking a resource link still invokes normal authorization. Handle revoked or
  deleted targets without leaking details.
- New grouped activity becomes unread even if its earlier group was read. Mark
  all read applies to a defined server-side cutoff, not concurrently arriving events.
- Multi-tab/device reads and preference changes synchronize. Elect one foreground
  tab for toasts; do not replay a burst of stale toasts after reconnect.
- After quiet hours, summarize deferred toasts rather than playing every toast.
  Preserve all eligible activity in the inbox.

### Proposed extensions (unapproved)

- **Snooze and archive/delete:** snooze an inbox entry until a chosen time (it
  resurfaces as unread); archive or delete entries. See open question 10.
- **Approvals:** review/approval requests carry reminders and escalation after a
  configurable delay. Notifications link to the approval; they never approve.
  Recipients are rechecked against current approver rights.
- **Thresholds:** stuck/long-running Job and Desktop Session alerts and quota
  warnings use configurable thresholds (instance default, per-user override
  within bounds), with one notice per crossing, not per poll.
- **Per-resource watch:** set a watch from the resource page and from Favorites
  (see [13-favorites.md](./13-favorites.md)), not only Profile. Same override
  semantics as section 5; a favorite is an implicit watch, an explicit watch is separate.
- **Webhook/Slack/Teams:** outbound channel, per user and per namespace.
- **CLI:** `mice notifications` list/read/watch using a PAT with a notifications scope.
- **Admin delivery health:** queue depth, oldest due delivery, dead letters and
  provider errors, visible to instance admins without notification content.

Grouping must not cross permission boundaries or merge distinct personal security
and access outcomes into an opaque activity count. Keep constituent events for
read state, authorization filtering, retention, and inspection.

## 7. Durable architecture

For the approved single-instance scope, atomically replaced local JSON stores
notification recipients, inbox state, preferences, subscriptions, and delivery jobs.
The audit journal supports replay of captured events after interrupted projection.
Do not run multiple auth writers against this store.

Pipeline:

`successful domain transition -> durable event/outbox -> recipient resolution
-> inbox projection + channel jobs -> permission/preference recheck -> delivery`

- Use stable event IDs and unique `(event, recipient)` and delivery keys.
  Fan-out and workers must resume safely after crashes.
- Use bounded batches, indexed access lookup, recipient cursors, retry backoff,
  provider throttling, and dead-letter status with visible operational errors.
- Delivery is at least once internally. Inbox projection is idempotent;
  provider idempotency should be used where available. Do not promise exactly-once
  external delivery when a provider response can be lost.
- Persist identities and authorized contact/group information for offline users.
  Never enumerate recipients using only currently connected browser sessions.
- Poll for live updates every 10 seconds. Unread counts remain server-authoritative
  and permission-filtered; do not require cross-replica live transport.
- Web Push requires a service worker, HTTPS deployment, VAPID configuration,
  per-device subscriptions, and invalid-subscription cleanup.
- Email requires configured transport, sender identity, verified recipient policy,
  safe templates, unsubscribe/preferences links, and provider failure handling.
- Use IANA timezones and explicit DST rules for quiet hours and digest schedules.
  Recheck permissions when assembling and dispatching each digest.
- Retention cleanup covers events, recipient entries, grouped constituents,
  delivery payloads, retries, and dead letters. Do not retain expired notification
  contents indefinitely in operational tables or logs.

### Reliability boundary and future multi-instance work

Audit replay can recover an event already appended to the journal, but it cannot
recover a crash between a domain/upstream mutation and audit append. Closing that
gap requires a transactional domain outbox or upstream reconciliation; do not
claim exactly-once domain capture for this single-instance implementation.

A future PostgreSQL notification queue alone would not make MICE multi-instance safe.
Inventory file-backed AuthZ, metadata, job/session state, token/device state, and
audit writers. Shared current authorization and safe producer ownership are
prerequisites, not optional follow-up hardening.

For local database mutations, commit the domain change and event atomically or
provide a durable reconciler. Oxen mutations are remote and cannot share that
transaction: define write-ahead intent, stable operation identity, outcome
verification, and recovery for crashes after upstream success. Do not call a
best-effort audit callback a transactional outbox. Ambiguous upstream outcomes
must surface operationally and must not become invented successful events.

Choose and approve a safe shared-state migration/coordination approach before
declaring multi-auth support. Migration scope must remain directly necessary for
correct notification capture, authorization, and producer coordination.

## 8. Proposed data and API contracts

Data:

- Event: ID, schema version, type/category, actor identity, occurrence time,
  canonical resource references, safe typed summary data, correlation/operation ID.
- Recipient/inbox entry: event/user identity, relevance reasons, read state,
  grouping key, creation/expiry timestamps; authorization checked dynamically.
- Preferences: user identity, global/category/channel settings, email schedule,
  timezone, quiet hours, typed resource overrides, optimistic concurrency version.
- Delivery: recipient, event/digest identity, channel, due time, lease, attempt
  count, state, provider reference, last error, expiry.
- Push subscription: user/device identity, endpoint, subscription keys, consent
  state; protect endpoint/key material and never expose another user's records.
- Webhook endpoint (proposed): owner (user or namespace), kind (generic/Slack/Teams),
  URL, signing secret reference, consent/verification state, categories, last
  success/failure. URL and secret are write-only after creation.
- Inbox entry additions (proposed): snoozed-until and archived/deleted state.

Proposed user-scoped routes under `/auth/notifications`:

| Route | Purpose |
| --- | --- |
| `GET /` | Permission-filtered cursor-paginated inbox |
| `GET /unread-count` | Permission-filtered count |
| `PATCH /:id` | Set own entry read/unread |
| `POST /read-all` | Mark eligible entries read through a server cutoff |
| `GET/PATCH /preferences` | Read/update own preferences with concurrency checks |
| `PUT/DELETE /resource-overrides/:id` | Set/remove typed resource override |
| `POST/DELETE /push-subscriptions` | Register/remove own device subscription |
| `PATCH /:id` (snooze/archive) | Proposed: snooze until a time, archive or delete own entry |
| `GET/POST/DELETE /webhooks` | Proposed: own endpoints; namespace endpoints need namespace-admin and live under the namespace |
| `POST /webhooks/:id/test` | Proposed: send a test payload |
| `GET /auth/notifications/admin/health` | Proposed: instance-admin delivery health |
| `GET /stream` | Authenticated live changes with resume cursor |

CLI use (`mice notifications list|read|watch`) authenticates with a PAT carrying a
notifications scope; scoped PATs must not reach other routes. Revocation and expiry
apply as for any PAT.

Use existing auth, request-validation, CSRF/origin, and error conventions.
Preference changes never accept an arbitrary recipient identity from the caller.
Define announcement administration separately with instance-admin authorization.
No public unauthenticated endpoint may reveal inbox contents or subscription data.

## 9. Delivery phases

All phases are required for the requested first-release scope; an inbox-only
milestone is useful internally but does not complete the feature.

1. **Contract and infrastructure:** settle open decisions; inventory every event
   producer; define permission mapping, event schema, local persistence, and
   recovery guarantees.
   Settle the open questions for new channels and events (12-19).
2. **Durable event backbone:** implement single-writer storage, audit capture and
   replay, identity/access resolution, idempotent fan-out, and durable delivery retries.
3. **Profile and in-app experience:** preferences and resource hierarchy, inbox,
   read state/counts, grouping, live updates, online toasts, and access-loss handling.
   Proposed: snooze/archive/delete and per-resource watch from Favorites and resource pages.
4. **External delivery:** email immediate/digests, Web Push consent/subscriptions,
   quiet hours/DST, retries, cancellation, and visible delivery failures.
   Proposed: webhook/Slack/Teams channel (user and namespace), admin delivery-health view.
5. **Complete catalog and release:** wire every agreed event category and admin
   announcements; test recovery/load/privacy; document configuration and operations.
   Proposed: PAT expiry, admin Session revocation, new-device and admin security
   alerts; approval requests with reminders/escalation; stuck-job/session and
   quota alerts; `mice notifications` CLI.

## 10. Acceptance and verification

- Each catalog event reaches precisely eligible users, including offline users
  and group-based members; unrelated users and unauthorized admins see no details.
- All accessible-resource defaults work without explicit watches. Parent mute,
  child override, personal notices, category disable, and global disable compose
  according to the documented precedence.
- Routine self-edits do not notify the actor; their own job/session outcomes do.
- Counts, groups, stream updates, digests, and pending dispatch reveal no revoked
  resources. Access grant does not expose prior activity.
- All four channels work end to end, with email/push initially opt-in. Quiet hours
  do not delay inbox visibility; no mandatory bypass exists.
- Healthy immediate inbox availability and dispatch meet the agreed 30-second
  target at a defined load; provider/browser delays are separately observable.
- A single auth instance processes retries, reconnects, and restarts without
  duplicate inbox entries for journaled events. Document the upstream-success
  capture gap and remaining external-delivery duplicate risks.
- Daily/weekly email and quiet hours work across DST and preference changes;
  grouped updates and read-all preserve concurrent new activity.
- Expired notification content is removed after 90 days; unread entries do not
  live forever. Audit retention remains independent.
- Exercise unit tests for policy/scheduling, database integration tests for queue
  and recovery, and Playwright for profile, inbox, permissions, and consent.
  Use local mail/push test doubles, not real personal delivery destinations.

Proposed additions (all unchecked, unapproved):

- [ ] PAT expiring-soon and expired notices reach only the token owner (phase 5), once per threshold, and no output, log or payload contains a token value.
- [ ] Admin Session revocation notifies the affected Principal; the revoked Session and pre-cut-off PATs stop working, newer PATs keep working (phase 5).
- [ ] New-device/location sign-in notices reach only the signing-in user (phase 5).
- [ ] CSRF cross-site and author-injection rejection alerts reach instance admins only, are rate-limited, and carry no request body, cookie or token (phase 5).
- [ ] Webhook/Slack/Teams delivery works per user and per namespace with signed payloads, retries, dead letters and no secret/URL exposure after creation; blocked destinations are refused (phase 4).
- [ ] Snooze resurfaces an entry as unread at the chosen time; archive/delete removes it from counts and lists (phase 3).
- [ ] Approval requests notify only current approvers, remind and escalate on schedule, and stop once decided (phase 5).
- [ ] Stuck/long-running Job and Desktop Session alerts and quota warnings fire once per configured threshold crossing (phase 5).
- [ ] `mice notifications list|read|watch` works with a notifications-scoped PAT and fails with a PAT lacking the scope or an expired/revoked one (phase 5).
- [ ] A resource can be watched from Favorites and its own page, and the effective state matches Profile (phase 3).
- [ ] The admin delivery-health view shows queue depth, dead letters and provider errors to instance admins only, without notification content (phase 4).

## 11. Further assessment questions

These remain open; do not treat proposals as approved requirements.

1. Resolved for this implementation: use a single auth instance. PostgreSQL and
   shared-state migrations remain a future deployment decision.
2. What user count, resources per user, peak events/second, fan-out, and replica
   count must meet the 30-second target? Is it a maximum or percentile SLO?
3. Which email transport/sender and recipient-verification policy should be used?
   What browsers/mobile platforms must Web Push support?
4. How should offline group membership freshness be established without external
   IdP event integration? May the system perform directory queries for current
   membership, and what should happen when membership cannot be verified?
5. When a resource is deleted, who may retain its deletion summary, and for how
   long? If access is later restored, should hidden unexpired entries reappear?
6. Should accessible-resource recipients receive other users' job outcomes and
   session events wherever authorized, or should those categories default to
   owners only? Which token/security transitions must be represented?
7. Which descendant types need individual mute controls in the first UI? What is
   the canonical ancestry for shared commits, scoped paths, and multi-mount jobs
   or sessions?
8. What daily send time, weekly day, timezone default, grouping window, and
   deferred-toast expiry should apply? Can users customize them?
9. Should marking an entry read cancel unsent email/push, or only update the inbox?
   Should a foreground toast suppress push on that device?
10. Must users be able to delete/archive notifications, or are the agreed read
    controls and automatic 90-day expiry sufficient?
11. Are administrator announcements immediate or schedulable, and should audience
    selection support namespaces/groups as well as the whole instance?
12. Webhook SSRF: which destinations are allowed (HTTPS only, host allowlist,
    block private/link-local/metadata ranges, DNS rebinding, redirects)? Who may
    configure namespace endpoints?
13. Webhook signing and secrets: signature scheme and replay window, secret
    rotation, and where secrets are stored (encrypted at rest, write-only)?
14. Webhook retry/backoff, timeout, payload size, ordering, and when to disable a
    failing endpoint? Slack/Teams payload formats versus generic JSON?
15. Do webhook payloads include resource names and summaries, or only a link?
    Namespace endpoints must not leak entries a recipient cannot see.
16. Admin security alerts: which recipients, thresholds and grouping window for
    CSRF/author-injection rejections, and may new-device detection store IP/location?
17. Approvals: reminder interval, escalation target and delay, and which
    approval types (GxP e-signature, merge) are in scope?
18. Alert thresholds for stuck/long-running Jobs and Sessions and for quotas: who
    sets them, and can users override them?
19. Which PAT scope name gates `mice notifications`, and is `watch` polling or
    the stream?

## 12. Documentation and repository handling

Implementation should update deployment/environment examples, user-facing profile
help, relevant API/event documentation, and operational recovery/runbooks.

This plan lives under `plans/`, which is tracked in git.
