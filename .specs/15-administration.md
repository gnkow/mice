Status: ready-for-agent

# 15 — Administration console and in-app docs (PLAT-ADMIN)

## Problem Statement

Admins need one place to manage users, roles, announcements, group bootstrap rules and instance state, and users need in-app documentation.

## Solution

A settings-based admin console with an overview, announcements targeted to audiences, group-bootstrap rules seeded from environment and editable in the UI, and a docs page.

## User Stories

1. As an instance admin, I want an overview of instance state (health, revocations; GxP strict is always on and shown as fixed), so that I know what is running.
2. As an instance admin, I want to publish announcements to a namespace or group, so that messages reach the right people.
3. As a user, I want to dismiss announcements and, when flagged requires-ack, acknowledge them with a receipt (content digest plus version).
4. As an admin, I want an optional "also notify" toggle for announcements, notifying on publish only after a recipient-count confirmation.
5. As an admin, I want group-bootstrap rules seeded from env (absent keys only) and editable in the UI with audit.
6. As an admin, I want to revoke a Principal's Sessions from the UI, singly or in bulk by directory group.
7. As an admin, I want to see a Principal's effective permissions with a why-trace.
8. As a user, I want a Docs page with Mice-authored content.
9. As a translator, I want strings in a message catalog, so that locales can be added.
10. As an auditor, I want every admin change audited.

## Implementation Decisions

- The admin overview stays under `/settings`.
- Announcements are audience-targeted only and immutable; a change is a new announcement plus retiring the old one.
- Bootstrap rules: env seeds absent keys only; UI-owned keys are never overwritten; both audited. Rule-derived grants are tagged with their source and revoked at next login.
- Read receipts server-side for every requires-ack announcement; acknowledgement is not comprehension; no blocking behaviour now.
- Fail closed on IdP disablement with no break-glass path.
- Docs: English only with message-catalog readiness; versioned with the release; SOPs live outside; plain-text announcements with link allowlist and step-up.

## Testing Decisions

- HTTP tests for announcement targeting, rule editing, and audit; Playwright for the UI.
- Prior art: existing admin e2e.

## Out of Scope

Additional locales, a separate `/admin` route.

## Further Notes

Rule precedence is decided: env seeds absent keys only and UI-owned keys win (Q10).

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Announcements
- Receipt is content digest plus version; an edit creates a new version; acknowledgement, not comprehension (Q1).
- Requires-ack flag plus completion report; no blocking now (Q2).
- Immutable announcements; change means new plus retire (Q3).
- Live audience with join-time rule; report distinguishes publish-time from later joiners (Q4).
- Sensitive notices target Mice namespace membership, not IdP groups (Q5).
- Plain text, link allowlist, step-up (Q22).
- Notify on publish only; recipient-count confirmation (Q26).
- No cache; indexed query per poll (Q18); unique (principal, revision) idempotent receipts (Q19).

Access administration
- Notify other admins and QA on access-changing actions; second approver for elevation; designed to split roles later (Q6).
- Fail closed; rely on IdP disablement (Q7).
- Bulk revoke by directory group with batch id and directory sync (Q8).
- Rule-derived grants tagged by source, revoked at next login (Q9).
- Seed absent keys only; UI-owned never overwritten (Q10).
- Self-approval forbidden; second reviewer for maintain/admin; no auto-escalation (Q13).
- Directory adapter interface plus adapter for the chosen IdP (Q16).
- Minimum length, caps, audit; non-admins limited (Q17).
- Best-effort per-item results with idempotent retry (Q20).
- No cache; per-request revocation read; per-chunk recheck (Q21).
- Effective-permissions view with why-trace (Q25).
- One open request per target, cooldown, rate limit (Q27).

Docs and testing
- Docs versioned with the release; SOPs outside (Q23).
- Error codes with client translation; audit codes (Q24).
- Table-driven HTTP suite on two instances (Q28).
- Inherited: strict always on (Q11), training out of scope (Q12), service principals removed (Q14, Q15).

## Conflicts and open risks

- Q7 RISK: break-glass declined; no incident-response path if the IdP is down or an admin is locked out. Aligns with 00 Q3 (absolute fail-closed) but is an accepted operational gap.
- Q6 vs 02/04: second approver and admin+QA notifications depend on enough distinct admins; separation of duties may be unmeetable on small instances.
- Q13 forbids auto-escalation, consistent with 14 Q4; a stalled reviewer is handled only by reassignment (14 Q5).
- Q26 notify-on-publish depends on 14; admin-wide audiences require a reason and audit (14 Q24).
- Q9/Q10 interplay: env reseeding never overwrites UI keys, so a corrupted UI value persists until edited.
- Q18/Q21 no caching: per-poll and per-request database reads add load; covered by 16 Q18 targets.
- Q5 uses Mice namespace membership, not IdP groups, so IdP-side changes do not retarget sensitive notices.
- Story 1 and 7 removed references to strict-mode toggle, PATs and service principals per global decisions.

## Update from authentication review
- Q16 IdP-migration tooling is moot (auth Q80); keep only the directory adapter for the single IdP.
- Q9/Q10 bootstrap rules grant read-only baseline only; write, sign and approve need a recorded admin grant (auth R1). Rules apply to everyone including externals, so guests must be kept out of privileged IdP groups.
- Q21 no revocation cache is confirmed (auth Q79).
- Revocation and suspend fail with 503 when immudb is down; no deferred append (auth R8).
- Quarterly signed access review report (auth S3) and daily IdP drift report (auth T5) are administration features.
- Support access does not exist (auth T3); Auditors are the only cross-user readers.

---

# Open Questions


Status: spec is `needs-info`; the console exists in code (Settings, announcements, access requests, bootstrap, training API) but the respec adds receipts, audiences, editable bootstrap rules and service principals on top of it.
Biggest risks: strict-mode admin actions that can deadlock a compromise response, receipts that look like GxP evidence but prove little, bootstrap rules that only ever add access, and a directory dependency on Keycloak that production will not have.
Every question carries an example, 2-4 options, a recommendation and the prior decision it challenges.

## Q1 [Domain] What does a server-side read receipt actually prove?
The spec says strict mode records a receipt when a user acknowledges an announcement. A compliance lead will present that receipt to an inspector as "read and understood" evidence, but a click on a banner proves neither reading nor understanding. A receipt is only meaningful if it is bound to the exact content the user saw, the Principal, the time and the means of authentication. Without that binding, an edited announcement can retroactively appear acknowledged.
Example: on Monday the banner says "Use Stage naming from 1 Nov"; Dr. Okafor acknowledges it. On Tuesday an admin edits the text to "Use Stage naming from 1 Dec". An auditor on Friday sees "Okafor acknowledged announcement 42" and concludes she knew about 1 Dec.
Options: (a) receipt stores a content digest and version, edits create a new version needing new acknowledgement; (b) receipt stores id and time only, edits forbidden once published; (c) treat receipts as informational and route "read and understood" to the training mechanism instead.
Recommendation: (a), and state explicitly in the validation documents that receipts are acknowledgement, not comprehension evidence.
Challenges: "Read receipts server-side for strict mode."

## Q2 [Domain] Which announcements must be acknowledged, and what happens to people who never do?
The spec lets users acknowledge in strict mode but never says whether acknowledgement is mandatory, who decides, or what the consequence of ignoring one is. In a regulated lab a "critical" notice such as a changed SOP is only useful if non-acknowledgement is visible and acted on. Making it blocking has its own cost: a user locked out of a running Job's data for ignoring a banner.
Example: 200 users in the Oncology namespace; the admin publishes a critical "new data-integrity SOP" notice. Three weeks later 37 have not acknowledged. Nobody has a report of who, and nothing prevents them from approving merges.
Options: (a) per-announcement "requires acknowledgement" flag with an admin completion report and no blocking; (b) same plus a gate on mutations after a grace period; (c) no mandatory mode, banners are informational only.
Recommendation: (a) now, with (b) deferred until the owner can name the SOP that demands it.
Challenges: New gap (the spec has receipts but no completion or enforcement model).

## Q3 [Impl] Editing an announcement versus the way dismissal is keyed today
Today dismissal is stored per browser and keyed by id plus last-updated time, so any edit re-shows the banner everywhere. With server-side receipts, an edit must decide whether to invalidate acknowledgements. Typo fixes should not force 400 people to re-acknowledge, but material changes must. A single "updated" timestamp cannot tell these apart.
Example: the admin fixes "recieve" to "receive" in a 1,800-character notice, and every user who dismissed the notice last week sees it again and a strict-mode receipt report drops from 190/200 to 0/200.
Options: (a) explicit "material change" checkbox on edit that bumps a revision and clears acknowledgements; (b) every edit is a new revision, always re-acknowledge; (c) immutable announcements, change means publish a new one and retire the old.
Recommendation: (c) for strict mode, since it gives the cleanest audit story, and (a) for non-strict.
Challenges: "Announcements are audience-targeted only" combined with receipts; existing per-browser dismissal behaviour.

## Q4 [Domain] Is an audience resolved at publish time or at read time?
Audience can be a namespace or a group, and "everyone" is explicit. The spec does not say whether the recipient set is frozen when the announcement is published or evaluated live each time a user loads the page. Live evaluation means someone who joins later sees an old critical notice and a leaver disappears from the denominator; frozen evaluation means new joiners never see it. For acknowledgement tracking the denominator matters.
Example: a notice targets the group "qa-reviewers" (12 members). Two days later a 13th person is added and one leaves. Is the completion report 11/12, 12/13, or 12/12?
Options: (a) live evaluation with the report showing current members plus historical acknowledgers; (b) frozen snapshot at publish with explicit late-joiner rule; (c) live evaluation, and a join-time rule that shows still-active critical notices.
Recommendation: (c), with the report distinguishing "was in audience at publish" from "joined later".
Challenges: "Audience targeting" with no resolution semantics.

## Q5 [Impl] Group membership is only known at login; how current is an audience?
Group claims arrive with the Session at login and are not refreshed. A user removed from "qa-reviewers" in the IdP at 09:00 keeps that group in a Session that lives for hours, and so keeps receiving group-targeted announcements (and group-driven bootstrap grants). The spec does not state a freshness bound. Announcement content can itself be sensitive (e.g. "audit finding in Site B").
Example: Site B's audit finding notice is targeted at group "site-b-qa". A contractor removed from the group at 09:00 still reads it at 16:00 on the original Session.
Options: (a) accept login-time groups and document the staleness bound as the Session lifetime; (b) re-resolve groups through the directory at a fixed interval; (c) restrict sensitive notices to namespace membership held in Mice, not IdP groups.
Recommendation: (c) for anything sensitive, (a) documented for the rest.
Challenges: Group-targeted audiences; New gap on freshness.

## Q6 [Domain] A single instance-admin tier has no separation of duties
The console puts enforce toggles, admin management, delegated permissions, bootstrap rules, revocation and announcements behind one all-powerful role, and the spec offers no second control. An admin can grant themselves a permission, edit a bootstrap rule to give a friend access, and the only brake is an audit entry they can read but nobody is told about. Part 11 and Annex 11 inspectors ask who can change access and who reviews it.
Example: admin Vik edits a bootstrap rule so group "contractors" gets `view_audit`. There are two audit entries and no alert; the QA lead finds out at the quarterly review, three months later.
Options: (a) keep one tier but notify all other admins and a QA role on every access-changing admin action; (b) two-person approval for privilege-granting changes; (c) split roles (user admin, platform admin, compliance viewer).
Recommendation: (a) now, design (c) permissions so (b) can be added later.
Challenges: "Admin overview stays under /settings" with one admin tier; "every admin change audited" as the only control.

## Q7 [Impl] Under GXP_STRICT an immudb outage blocks the admin who must respond to the incident
Strict mode fails every mutation closed with 503 when the Intent event cannot be appended. Revoking a compromised Principal is a mutation, so during an audit-store outage the admin cannot cut off the attacker, while the attacker's already-valid reads continue. The spec says "no class is exempt". Security response and audit completeness are in direct conflict here.
Example: at 14:02 an admin sees a PAT leaking data and clicks revoke; immudb has been down since 13:55 and the console answers 503 for as long as it stays down. The leaked PAT keeps working.
Options: (a) a documented break-glass revoke that writes the Intent to a durable local queue in PostgreSQL and is reconciled to immudb later; (b) keep fail-closed and rely on IdP-side disablement; (c) revoke-by-default-on-uncertainty, deny the affected Principal's requests when the audit store is down.
Recommendation: (a) with the queued Intent explicitly marked "deferred append" so that the gap is visible rather than hidden.
Challenges: "GXP_STRICT fail-closed for ALL mutations"; "admin revoke per iss+sub is the group-revocation path".

## Q8 [Domain] Revoke per iss+sub is not a group-revocation path
The cross-cutting spec uses per-Principal revocation as the way to remove a group's access. A decommissioned team of 40 people means 40 manual operations, each of which must be found by identity key rather than by name, and nothing asks whether the remaining group-derived grants are also removed. The code already ships a directory-sync offboarding route and tests, which contradicts "no directory sync". The owner may not realise that functionality exists.
Example: a CRO engagement ends; 40 contractor accounts in group "cro-acme". The admin revokes 38, misses two who used different emails, and those two keep PATs for six months.
Options: (a) add bulk revoke from a directory group selection with one batch id; (b) keep the existing directory sync as the supported offboarding path and fix the spec; (c) manual only, with a checklist report listing every Principal holding grants.
Recommendation: (b) plus (a); the code is ahead of the spec, and silent dead code is worse than a decision.
Challenges: "admin revoke per iss+sub is the group-revocation path"; "manual offboarding only (no SCIM)".

## Q9 [Impl] Bootstrap rules only add access; nothing removes it when the group does
Group bootstrap applies at login and writes instance permissions and namespace membership. There is no inverse: when the user loses the IdP group, the grants stay. Making rules editable in the UI raises the stakes, since an admin editing or deleting a rule will assume the grants it created are removed. They are not.
Example: rule "devs" gives `create_namespace`. Lena leaves the dev team in the IdP in March; in November she still creates namespaces because the grant was written once.
Options: (a) mark rule-derived grants with their source and revoke them at next login when the rule no longer matches; (b) keep additive semantics and show rule-derived grants in the admin UI with a one-click cleanup; (c) evaluate rule-derived access per request instead of persisting it.
Recommendation: (a), because it matches how an admin reasons about "group membership drives access".
Challenges: "Bootstrap rules: env seeds, UI edits override"; New gap on removal semantics.

## Q10 [Impl] "Env seeds, UI overrides" has no stable tie-break across restarts and N instances
The spec says env seeds and UI edits override, and the further notes admit a documented tie-break is missing. Concretely: does the seed run on every boot, only on an empty table, or per rule key? With several BFF instances starting in a rolling deploy, a seed run on every boot can silently overwrite an admin's edit, and two instances can race to insert the same rule.
Example: the admin changes rule "devs" from three to two permissions in the UI; a rolling upgrade restarts instance 2 with the old environment, which writes the old three permissions back.
Options: (a) seed only rules whose key does not exist, record origin, never overwrite a UI-owned rule; (b) the environment always wins and the UI shows env-owned rules as read-only; (c) drop the environment path after first boot.
Recommendation: (a), with a database-level unique key and an audited seed event.
Challenges: "Bootstrap rules: env seeds, UI edits override, both audited"; the open tie-break in Further Notes.

## Q11 [Impl] Admin authorization toggles that production forbids
The console still has an "enforce" checkbox, an env override, and a production gate that rejects the disabled state. The admin UI therefore offers a control whose off position is either forbidden or meaningless in the environment where it matters. A GxP validation document must explain it, and the audit entry `instance.settings.update` will record toggles that cannot take effect.
Example: in staging an admin unticks enforce for a demo; the entry reads "enforce=false" while a production gate blocks the same state elsewhere, so the validated and demo environments behave differently with the same build.
Options: (a) remove the toggle, enforce is always on and dev uses a dev-only grant mode; (b) keep it but render it read-only when the gate forbids; (c) keep as is and document.
Recommendation: (a).
Challenges: "Admin overview … strict mode, health, revocations" which lists settings the owner wants shown but never says which are editable.

## Q12 [Domain] Training: the spec dropped it but Annex 11 and Part 11 still require it
The plan carried training acknowledgement (API and a proxy gate exist, no web UI); the respec admin spec does not mention it. Part 11 11.10(i) expects persons who use the system to have the education, training and experience for their tasks, and an inspector will ask for the training record per user. If training lives only in a CLI call it will never be done by scientists, and if it lives outside Mice nobody can enforce it.
Example: Site A requires "Data Integrity v3" before any write. 90 scientists get a 403 on first push with no explanation and no UI to acknowledge, so they email the admin, who sets the flag for all of them without evidence.
Options: (a) bring training into scope: versioned course reference, self-acknowledge UI, admin report; (b) integrate with an external LMS through a signed attestation; (c) declare training out of scope and record that decision for validation.
Recommendation: (c) explicitly if the customer has an LMS, otherwise (a); silence is the worst of the three.
Challenges: Omission relative to the plan (Phase 3); "every admin change audited" while an admin override of training is possible.

## Q13 [Domain] Access-request review: who reviews, who may approve their own, and what is the SLA
Reviewers see requests and can approve with a namespace role or instance permission. The spec is silent on self-approval, conflict of interest, the reviewer when no one is available, and the target for "reviewer escalation" that the cross-cutting spec lists as unresolved. A request for write access on a GxP namespace approved by the requester's own manager-with-admin is a typical audit finding.
Example: Priya holds `review_access_requests` for Oncology and submits a request for `maintain` there herself; she approves it herself in 30 seconds, and the audit shows approver equals requester.
Options: (a) forbid self-approval and require a second reviewer for maintain/admin roles; (b) forbid self-approval only; (c) allow with an audit flag.
Recommendation: (a), with an escalation to instance admins after a configurable age.
Challenges: Access-request inbox without conflict-of-interest rules; "reviewer escalation target" left unresolved.

## Q14 [Impl] Service principals now: ownership, expiry and what offboarding does to them
The owner put service principals in scope for this iteration. The code suspends service principals owned by an offboarded user, which is a rule the spec does not record. Every non-human actor in the audit trail must still be attributable to a responsible human, and a pipeline that stops overnight because its owner left is an operational incident.
Example: `svc-nightly-ingest` is owned by Marc, who leaves on Friday. His offboarding suspends the principal and the Monday 02:00 import fails silently for two weeks.
Options: (a) require a named owner plus a secondary owner, and reassign on offboarding with a notification; (b) suspend automatically and notify owners' teams; (c) service principals belong to a namespace, not a person.
Recommendation: (a) with (b) as the fallback when no secondary exists.
Challenges: "service principals in scope now" without ownership lifecycle.

## Q15 [Domain] May a service principal act in a regulated, signed step?
Service principals will push data, trigger Jobs and possibly hold maintain on a Repository. Under the platform's rule that the maintain user signs at merge, a service principal with maintain can create the review gate's "signature". An electronic signature must be attributable to one individual and cannot be shared or automated.
Example: a CI service principal holds `maintain` and merges its own Job output into the main branch, so the signature manifest names "svc-ci" as the signer.
Options: (a) service principals may never hold the signing capability, enforced in authorization; (b) they may, and the audit labels them as automated approvals; (c) allow only in namespaces flagged non-GxP.
Recommendation: (a).
Challenges: "service principals in scope now" combined with "maintain user signs at merge".

## Q16 [Impl] Directory search needs Keycloak, and production has none
Directory pickers use a Keycloak admin adapter or a fallback that only knows people who already logged in. The cross-cutting decision says Keycloak is development-only and an external IdP is required. A production admin on Entra or Okta therefore gets the fallback and cannot grant access to someone who has not yet logged in.
Example: the admin wants to add 12 new hires to the namespace "Proteomics" before their first day, but the picker finds nobody because they have never signed in.
Options: (a) define a directory adapter interface and ship an adapter for the chosen IdP; (b) accept the fallback and grant access by identity key or verified email; (c) use group bootstrap for pre-provisioning and keep the picker store-only.
Recommendation: (a), choose the first production IdP now as it decides everything about groups.
Challenges: "Keycloak dev-only, external IdP required" versus the directory implementation.

## Q17 [Domain] Directory search discloses the corporate directory to every manager
Directory search is available to admins, reviewers and anyone with the manage-members permission. Searching returns names and emails of people unrelated to the searcher's work, and the search itself is not audited. Under GDPR data minimisation this is a disclosure with no purpose limitation.
Example: a namespace maintainer types "a" and pages through the entire 4,000-person directory including executives and works-council members.
Options: (a) minimum-length queries, result caps and audit of every directory search; (b) limit results to people with a Mice account or in allowed groups; (c) leave as is.
Recommendation: (a) plus (b) for non-admins.
Challenges: Directory search plan decisions; New gap.

## Q18 [Impl] Announcement delivery and invalidation across N instances
Clients poll the live announcements every few minutes, each poll resolving the user's audience against groups and namespace membership. With several BFF instances and per-user audiences this is the hottest admin-owned endpoint, and an admin hiding a critical notice (for example one published to the wrong audience) must take effect everywhere promptly.
Example: an admin publishes a notice to "everyone" containing a wrong deadline; 1,500 users poll every 5 minutes, instance 2 caches the list for 10 minutes, and the retraction takes 15 minutes to be consistent.
Options: (a) no cache, a simple indexed query per poll; (b) short cache with invalidation via PostgreSQL notifications; (c) push via the notification channel.
Recommendation: (a) with a measured budget; 1,500 users at one query per 5 minutes is 5 queries a second.
Challenges: "Announcements audience-targeted" without a consistency requirement.

## Q19 [Impl] Receipt data model and strict-mode behaviour when the audit store is down
A receipt is both a database row and, under strict mode, an audited mutation that needs its own Intent. If the Intent cannot be appended, the user cannot acknowledge and the banner stays, which is arguably correct. But repeated acknowledgements from several browsers or instances must not create duplicate receipts, and an acknowledgement racing an edit must bind to the version the user actually saw.
Example: Dr. Chen double-clicks acknowledge on two tabs, one hitting instance 1 and one instance 2, while an admin edits the notice at the same moment, giving two receipts, one against the old and one against the new revision.
Options: (a) unique on principal plus revision, idempotent insert returning the existing receipt, with the revision supplied by the client; (b) one receipt per principal and announcement, overwritten on edit; (c) receipts append-only in the audit store only.
Recommendation: (a).
Challenges: "Read receipts server-side"; strict fail-closed applied to a user-level action.

## Q20 [Impl] Bulk actions and partial failure in the inbox and permission lists
Pagination and bulk approval are planned: one audit event per item, shared batch id. Under strict mode each item needs an Intent first, so approving 80 requests means 80 sequential appends, and an outage in the middle leaves 47 done and 33 not. The spec does not define batch atomicity or idempotent retry.
Example: the reviewer selects 80 pending requests after a new project onboarding; 47 succeed, then immudb blocks; the UI shows a generic error and she does not know what changed.
Options: (a) best-effort with a per-item result list and idempotent retry on the batch id; (b) all-or-nothing in PostgreSQL after one batched Intent; (c) no bulk, only filters.
Recommendation: (a), because one Intent per item is what the audit model requires.
Challenges: Plan Phase 1 bulk actions; fail-closed per mutation.

## Q21 [Impl] Revocation latency across instances and the cost of checking it on every request
Revocation by iss+sub sets a not-valid-before cut-off, checked on each authenticated request including PAT use. With N instances, any local cache of cut-offs makes revocation eventually consistent; with no cache, every request does an additional database read. The spec states neither a freshness bound nor a performance cost.
Example: a PAT is revoked at 10:00:00; instance 3 caches revocations for 60 seconds and serves a 40 GB download that started at 10:00:30 to completion.
Options: (a) no cache, one indexed read per request, with a stated bound of zero; (b) cache with a stated bound (5 seconds) and pub/sub invalidation; (c) check on request start only and document long transfers as unaffected.
Recommendation: (a) now, since the read is cheap next to the oxen round trips, plus a rule on in-flight streams.
Challenges: "admin revoke per iss+sub" without semantics for N instances and long transfers.

## Q22 [Domain] The console is the place where a compromised admin does most damage; what protects it?
Admins can publish notices to everyone, add admins and grant permissions. A hijacked admin Session can push a banner with a phishing link to every user, because the spec allows Markdown/links in the plan and offers no step-up or confirmation. A fake "critical" notice that asks for PAT re-entry is a real attack on a lab.
Example: a hijacked admin account publishes "Maintenance: re-authenticate at https://mice-login.example-evil.test" as critical to everyone, and 300 users see it.
Options: (a) plain text only plus an allowlist for links and step-up authentication before any access-changing or everyone-audience action; (b) Markdown sanitised, no step-up; (c) plain text only.
Recommendation: (a); the code already has a step-up mechanism that is the obvious reuse.
Challenges: "Announcements audience-targeted only" with "everyone" as a one-click audience.

## Q23 [Domain] Docs content is a controlled document in a GxP setting, not a help page
The spec assumes English-only content with catalog readiness but leaves ownership open. If the in-app Docs page tells a scientist how a GxP workflow works, then a change to that text is a change to an operating instruction. Auditors will ask which version of the instructions was valid on the date a record was made.
Example: the docs say "merge requires maintain" until release 1.4, then "merge requires a second reviewer"; an auditor inspecting a March merge cannot tell which instruction applied.
Options: (a) docs shipped and versioned with the release, with the version recorded and old versions retrievable; (b) docs served from an external controlled-document system and only linked; (c) unversioned living docs, marked non-normative.
Recommendation: (a) with an explicit statement that SOPs live outside Mice.
Challenges: "Docs content ownership and locales are open"; plan option of a configurable docs URL.

## Q24 [Impl] i18n readiness stops at the web bundle, but the user-visible strings come from the server too
The spec asks for a message catalog "readiness" for web strings. Audit action labels, notification text, error messages and announcement content are generated by the BFF or typed by admins. Retrofitting later means touching every error contract that the CLI and tests match on.
Example: the CLI prints the BFF error "Forbidden: requires maintain" and a Japanese-language site reports the audit label for an approval as English-only in an exported report.
Options: (a) stable error codes plus client-side translation, with audit labels stored as codes; (b) web-only catalog, server stays English; (c) drop i18n from this spec.
Recommendation: (a) for errors and audit labels now, since it is cheap before the contracts freeze.
Challenges: "message-catalog readiness" in the Solution.

## Q25 [Impl] Delegated permissions are per user, and the console will be unmanageable at scale
Instance permissions can be delegated per individual user, with pagination planned. With bootstrap rules by group already existing, a hybrid exists where the same permission may come from a rule, from a user grant or from a role, and the UI must explain effective permissions. The spec does not provide an "effective permissions" view or defaults for who may delegate what.
Example: Sam has `view_audit` from group "qa", a direct grant, and a custom role; the admin removes the direct grant and Sam still has it, so the admin concludes the removal failed.
Options: (a) effective-permissions view showing every source and a "why" trace; (b) permissions only via groups and roles, no per-user grants; (c) leave as is.
Recommendation: (a), and prefer (b) as the default practice in documentation.
Challenges: "admin under /settings" scope with no effective-permissions requirement; plan Phase 1 lists.

## Q26 [Impl] "Also notify" meets "every category on by default" and a 1,500-person audience
Publishing with the toggle emits an inbox notification, and all catalog categories default to on, including email where it is configured. One announcement to everyone can create 1,500 inbox messages and emails, with each delivery an audited, Novu-bound operation. The spec says nothing about fan-out limits, partial failure, or throttling of repeated edits.
Example: an admin edits a typo three times with "also notify" on; users receive four emails each, so 6,000 emails in a minute from one Novu worker.
Options: (a) notify only on publish and on material revision; (b) digest per user per hour; (c) leave unlimited.
Recommendation: (a), plus a recipient count confirmation shown to the admin.
Challenges: "announcements audience-targeted only" with "all notification categories on by default".

## Q27 [Impl] Access-request intake can be abused and has no rate limit
Any signed-in user with zero grants can submit access requests from the pending page, with a free-text message. There is no mention of limits, duplicate suppression, or content handling. A user with a valid IdP account but no business need can flood reviewers, and the notifications default means each submission pages every reviewer.
Example: a mis-scripted user submits 500 requests overnight; 12 reviewers each receive 500 notifications and the real new-joiner request is lost.
Options: (a) one open request per user per target with a cooldown; (b) rate limit per Principal at the BFF; (c) accept.
Recommendation: (a) plus (b).
Challenges: Access request UX with no abuse rules.

## Q28 [Impl] Test strategy: the HTTP boundary cannot verify the admin UI claims
The spec tests announcement targeting, rule editing and audit at the HTTP boundary, with Playwright for the UI. Multi-Principal behaviour (audience, receipts, revocation latency) needs several authenticated Principals and a second BFF instance, but the existing browser suite runs one worker and stops at the first failure. Accessibility and Markdown sanitisation are claimed in the plan but have no test home.
Example: a regression makes group audiences match case-sensitively; the single-user e2e passes while real groups "QA-Reviewers" and "qa-reviewers" diverge.
Options: (a) a table-driven HTTP suite with generated Principals for audience and receipts, two instances for revocation, UI e2e kept to a few journeys; (b) UI-heavy tests; (c) unit tests on stores.
Recommendation: (a).
Challenges: "tests at BFF HTTP boundary against real containers" applied to a UI-heavy module.

## Decisions log

| Q | Answer | Date |
| --- | --- | --- |
| Q1 | Receipt = content digest + version; edit => new version; acknowledgement not comprehension | answered |
| Q2 | requires-ack flag + completion report; no blocking now | answered |
| Q3 | Immutable announcements; change = new + retire | answered |
| Q4 | Live audience; join-time rule; report distinguishes publish vs later joiners | answered |
| Q5 | Sensitive notices by Mice namespace membership, not IdP groups | answered |
| Q6 | Notify other admins+QA on access-changing actions; second approver for elevation; design to split later | answered |
| Q7 | Keep fail-closed; rely on IdP disablement (NOTE: break-glass declined; incident-response gap RISK; aligns with 00 Q3) | answered |
| Q8 | Bulk revoke by directory group w/ batch id + directory sync | answered |
| Q9 | Rule-derived grants tagged source; revoked at next login | answered |
| Q10 | Seed absent keys only; UI-owned never overwritten | answered |
| Q11 | Inherited: strict always on, toggle removed | answered |
| Q12 | Inherited: training out of scope | answered |
| Q13 | Forbid self-approval; second reviewer for maintain/admin; no auto-escalation | answered |
| Q14 | Inherited: service principals removed | answered |
| Q15 | Inherited: service principals removed | answered |
| Q16 | Directory adapter interface + chosen-IdP adapter | answered |
| Q17 | Min length, caps, audit; non-admins limited | answered |
| Q18 | No cache; indexed query per poll | answered |
| Q19 | Unique (principal, revision) idempotent | answered |
| Q20 | Best-effort per-item results + idempotent retry | answered |
| Q21 | No cache; per-request revocation read; per-chunk recheck | answered |
| Q22 | Plain text, link allowlist, step-up | answered |
| Q23 | Docs versioned with release; SOPs outside | answered |
| Q24 | Error codes + client translation; audit codes | answered |
| Q25 | Effective-permissions view w/ why trace | answered |
| Q26 | Notify on publish only; recipient count confirm | answered |
| Q27 | One open request per target + cooldown + rate limit | answered |
| Q28 | Table-driven HTTP suite, 2 instances | answered |

---

# Known Issues and Conflicts

## Conflicts with Other Specs

1. **Break-glass declined (Q7)**: RISK - No incident-response path if IdP down or admin locked out. Aligns with 00 Q3 (absolute fail-closed) but accepted operational gap.

2. **Second approver dependency (Q6 vs 02/04)**: Depends on enough distinct admins. Separation of duties may be unmeetable on small instances.

3. **No auto-escalation (Q13)**: Consistent with 14 Q4. Stalled reviewer handled only by reassignment (14 Q5).

4. **Notify-on-publish (Q26)**: Depends on 14. Admin-wide audiences require reason+audit (14 Q24).

5. **Env reseeding persistence (Q9/Q10 interplay)**: Env never overwrites UI keys, so corrupted UI value persists until edited.

## Open Risks and Blockers

6. **No caching (Q18/Q21)**: Per-poll and per-request database reads add load. Covered by 16 Q18 targets.

7. **Mice namespace membership (Q5)**: Uses Mice namespace membership not IdP groups, so IdP-side changes don't retarget sensitive notices.

8. **Service principals removed**: Story 1 and 7 removed references per global decisions (Q14, Q15).

## Update from Authentication Review

9. **IdP migration tooling (Q16)**: Moot (auth Q80). Keep only directory adapter for single IdP.

10. **Bootstrap rules (Q9/Q10)**: Grant read-only baseline only (auth R1). Write/sign/approve need recorded admin grant. Rules apply to everyone including externals.

11. **No revocation cache (Q21)**: Confirmed (auth Q79).

12. **Revocation fail-closed (Q7)**: Revoke/suspend fail with 503 when immudb down; no deferred append (auth R8).

13. **Access review reports**: Quarterly signed access review (auth S3) and daily IdP drift report (auth T5) are administration features.

14. **Support access removed**: Auth T3 - Auditors only cross-user readers.

# Impact on Other Specs

## Dependencies on Other Specs

- **00 (Cross-cutting)**: Q7 aligns with 00 Q3 (absolute fail-closed); break-glass declined
- **14 (Notifications)**: Q26 notify-on-publish with recipient-count confirmation; Q24 admin-wide audiences
- **01 (Authentication)**: Q16 IdP migration moot (auth Q80); Q9/Q10 bootstrap rules (auth R1); Q21 no revocation cache (auth Q79); Q7 revoke fail-closed (auth R8)
- **02/04 (Authorization/Signatures)**: Q6 second approver for elevation; Q13 self-approval forbidden
- **16 (Infrastructure)**: Q18/Q21 no-cache load covered by 16 Q18 targets

## Impacts on Other Specs

- **02 (Authorization)**: Q9 rule-derived grants tagged by source, revoked at next login; Q10 env seeds absent keys only
- **01 (Authentication)**: Q8 bulk revoke by directory group; Q16 directory adapter for chosen IdP
- **04 (Signatures)**: Q13 second reviewer for maintain/admin; no auto-escalation
- **14 (Notifications)**: Q4 live audience with join-time rule; Q26 recipient-count confirmation for announcements
- **15 (Administration)**: Q25 effective-permissions view with why-trace; auth S3 quarterly access review; auth T5 daily IdP drift report

## Cross-Cutting Concerns

- **Fail-closed strict mode**: Q7 no break-glass (RISK); revoke/suspend fail 503 when immudb down
- **Multi-instance coordination**: Q18 no cache on announcements; Q19 unique (principal, revision) idempotent receipts
- **Announcements**: Q1 receipt=digest+version; Q3 immutable (change=new+retire); Q4 live audience; Q22 plain text, link allowlist, step-up
- **Access administration**: Q6 notify admins+QA on access changes; Q8 bulk revoke by directory group; Q9 rule-derived grants tagged
- **Bootstrap rules**: Q10 seed absent keys only; UI-owned never overwritten; Q9 revoked at next login
- **Directory integration**: Q16 adapter interface + chosen-IdP adapter; Q17 min length, caps, audit
- **Docs and testing**: Q23 docs versioned with release; Q24 error codes + client translation; Q28 table-driven HTTP suite on 2 instances

