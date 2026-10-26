Status: ready-for-agent

# 02 — Authorization (PLAT-AUTHO)

## Problem Statement

Every request to oxen-server and to Mice features must be allowed or denied by a clear role model, with default-deny, so that scientists see only what they should.

## Solution

The BFF classifies every route to an action, resolves the Principal's roles through namespace and repository membership, groups, instance permissions and custom roles, and denies anything unclassified (ADR 0002). Resources are keyed by stable repository id. Stage actions use a `stage` resource directly.

## User Stories

1. As a repository admin, I want to grant read, write, maintain or admin to users and groups, so that access is least-privilege.
2. As a namespace owner, I want namespace roles to flow to repositories, so that I manage access once.
3. As an instance admin, I want custom roles built from an action catalog, so that I model our organisation.
4. As an instance admin, I want delegated instance permissions, so that I can split admin duties.
5. As a security reviewer, I want unclassified routes denied, so that new oxen endpoints are never open by accident.
6. As a developer, I want a test that the path map and the role checks agree, so that they cannot drift.
7. As a user, I want a denied request to explain what permission is missing without leaking resource existence, so that I can ask for access.
8. As an auditor, I want every grant, revoke and role change audited, so that access history is reconstructable.
9. As a CLI user, I want my credential scopes to narrow, never widen, my live permissions.
10. As an instance admin, I want Jobs to run under BFF-internal tokens governed by the submitting user's permissions, so that automation is controlled without service principals.
11. As a developer, I want `stage.*` action names from day one, so that no legacy names or aliases exist.
12. As a user of a renamed repository, I want my access unchanged, so that renames are not a permissions event.
13. As an instance admin, I want to see why an access decision was made, so that I can debug.

## Implementation Decisions

- Default-deny; every unclassified route is denied, ADR 0002 is updated, and the parity test fails on any new route.
- Authorization references stable repository ids so rename and transfer do not orphan grants.
- Group membership is re-checked against the directory on use with a stated maximum staleness, plus an admin refresh action; revocation per Principal is the immediate path.
- Stage (Oxen workspace) actions use a `stage` resource with no aliases or migration.
- Chunked upload and import routes are explicitly classified at repo `write` and re-authorized at each chunk and at publish.
- Transfer needs source repo `admin` plus destination namespace Owner approval; collaborators are dropped by default.
- Mandatory expiry on outside and delegated grants and scheduled access-review campaigns are both included.
- State lives in PostgreSQL and is consistent across instances.

## Testing Decisions

- Black-box HTTP tests per role and action, including denied cases and unclassified routes.
- A parity test comparing the path map with the enforcement logic.
- Prior art: existing authz matrix tests.

## Out of Scope

Breakglass, and "internal" visibility.

## Further Notes

Transfer is a BFF metadata change with no oxen move (05 Q25, Q10); confirm that oxen paths do not embed the namespace.

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Roles and guards
- Self-merge is forbidden everywhere with no override, so every repository needs at least two eligible mergers (Q1).
- Last-owner and last-admin guards use database constraints and locking, with a two-instance test (Q7). Removing the last Owner is blocked; an offboarded Owner alerts instance admins and requires a new Owner within N days (Q23).
- A namespace Owner gets Admin, but collaborator grants on restricted or GxP repositories need data-owner approval or notification (Q10).
- Members create repositories only where the Owner allows; the default is private to the creator and namespace admins (Q18).
- Mandatory expiry on outside and delegated grants, and scheduled access-review campaigns, both now (Q11).
- Only main is protected globally (Q17).
- Training is not implemented: out of scope, no self-attestation; revisit (Q25).

Classification and identity
- Deny every unclassified route; update ADR 0002 (Q2). A contract test enumerates the routes of the pinned oxen, with an exact server pin (Q3).
- Repository ids are assigned at creation in one transaction; a reconciliation report covers pre-existing repositories (Q4).
- Grants, favorites and scopes are keyed by repository id only; a recreated name gets a new id and the old name returns 404/410 for a period (Q5).
- Transfer needs source repo admin plus destination namespace Owner approval; collaborators are dropped by default (Q6).
- Credentials are scoped to repository id plus action and intersected with live permissions; PATs do not exist (Q19). Service principals are removed (Q21).
- Groups are bound on IdP group id plus issuer; a disappeared group warns and missing claims fail loudly (Q13). Directory groups are re-checked on use within a staleness bound, with an admin refresh (Q12).
- Chunked uploads are re-authorized at each chunk and at publish, cached within the staleness bound (Q14).

Visibility, elevation and audit
- Instance admin has no data access by default; elevation needs a reason, a time-box, a second approver in strict, and an audited Intent; read and write are distinguished (Q8).
- A read-only, time-boxed, audited Auditor/Inspector role is added (Q16).
- Bypass mutations and sensitive reads are audited individually; routine listing reads become one summary event per page or session (Q9).
- Denials return 404 for no-read and 403 for visible-but-forbidden; reason codes appear only in audit and Administration; timing is consistent (Q22).
- All listings, search, counts, activity and favorites are filtered server-side, with a leakage test per list endpoint (Q15).
- Events carry namespaces and repo ids; a namespace view shows only fully visible events; cross-namespace needs instance auditors (Q28).
- There is no hard delete; archive only, and audit and lineage are retained (Q24).
- Testing uses a generated route-by-role-by-state matrix at the BFF boundary plus targeted tests (Q26).
- Q20 and Q27 are inherited (new project; absolute fail-closed).

## Conflicts and open risks

- Q17: only main is protected; force-push and deletion of other released branches stay unprotected. RISK, accepted as chosen (05 Q12 mitigates with revert-only).
- Q12 (staleness-bounded directory re-check) versus 15 Q21 (no cache, per-request revocation read) and 01 Q4 (about 2 s cache): CONFLICT on caching; a single staleness figure must be set across 01, 02 and 15.
- Q9 (routine listing reads summarized) versus 00 Q4 (all reads audited): reconciled only if the summary event counts as the audit; confirm in 03.
- Q1: forbidding self-merge needs two eligible mergers per repository; small repositories cannot merge until a second maintainer exists, and 04 Q18 says escalation is unconfirmed.
- Q6 and 05 Q10: transfer is a BFF metadata change with no oxen move; PENDING confirmation that oxen paths do not embed the namespace.
- Q8 (second approver in strict) versus 15 Q6 (second approver for elevation, design to split later): consistent; strict is now always on, so the second approver is always required.
- Q4: pre-existing repositories need a reconciliation report; 16 Q24 says the pilot is wiped, so this may be moot.
- Q21 and Q19: PATs and service principals are gone; 07, 09 and 12-14 still reference them in places.
- Q25: training gating is deferred; no self-attestation is built.
- Q2 and 05 Q17, 11 Q25: unclassified routes are denied; lineage classification failure creates a gap op rather than a bypass.

---

# Open Questions


Status: spec is `ready-for-agent`; code already enforces a name-keyed, GitHub-shaped model, and the spec layers a stable repository id, `stage` renames and default-deny on top. 28 questions follow.
Biggest risks: the review gate (Merge+maintain) has no separation of duties; there is no stable repository id in the code today; group/PAT access goes stale; unclassified routes are "denied" in one place and "admin" in another.
Tags: [Domain] = regulated-workflow/compliance concern, [Impl] = engineering concern.

## Q1 [Domain] Merge+maintain as the review gate allows self-approval
The owner decided that a user with maintain rights who merges is the reviewer, and that no separate approver exists. Nothing in the role model stops the person who wrote the change from also merging it, and a repository Admin or namespace Owner holds maintain implicitly. Part 11 and most GxP SOPs require independent review of a record by someone other than its originator. A review gate that can be satisfied by the author is a signature, not a review.
**Example:** Dana pushes a corrected potency table to a branch and, being a maintainer, merges it herself six minutes later and signs. The audit shows a valid merge with a valid e-signature.
**Options:**
- Enforce author ≠ merger on repositories marked as GxP: independent review, small teams get blocked.
- Require a separate "approve" action that maintainers cannot self-apply: strongest, contradicts the "no separate approver" decision.
- Keep as is and rely on SOP: no build, no technical control.
**Recommendation:** Option 1 as a per-repository setting, with an audited, reasoned override by a different admin.
**Challenges:** "e-sig = maintain user signs at merge, no separate approver; Merge+maintain is the review gate".

## Q2 [Impl] Unclassified routes are "denied" and "admin" at the same time
Story 5 says unclassified routes are denied. The decisions say unclassified mutations default to Admin. These are different outcomes: Admin-only lets any repository Admin invoke an unreviewed route, including one that does not go through author injection or audit, while deny blocks everyone. ADR 0002 also denies only GETs without scope. The spec cannot be tested until it says which behaviour is intended.
**Example:** The pinned oxen-server adds a bulk-delete endpoint in the next release. Under "admin default" a repository Admin can call it today; under "deny" it is unreachable until classified.
**Options:**
- Deny all unclassified requests, GET and mutating: safest, new routes break loudly.
- Admin-only for unclassified mutations, as decided: friendlier, unreviewed power.
- Deny in strict mode, Admin otherwise: two behaviours to validate.
**Recommendation:** Option 1; update ADR 0002 accordingly and make the parity test fail on any new route in the pinned oxen version.
**Challenges:** Story 5 versus "Default-deny; unclassified mutations default to `admin`".

## Q3 [Impl] The parity test cannot detect new routes in the oxen version we pin
The parity test compares the BFF path map to the BFF enforcement logic, both written by us. It says nothing about routes oxen-server actually exposes, and the CLI is pinned to an exact version while the server version can float. Drift appears when the server grows a route and nobody notices until a user finds it. Real containers are available in tests, so the real route list is discoverable.
**Example:** oxen-server 0.60 adds a workspace-export route that streams a whole repository. The map and the check agree with each other, both unaware, and the route is reachable by repository Admins only because of the fallthrough.
**Options:**
- CI step that extracts routes from the pinned server image and fails on any not in the map: real coverage, tooling needed.
- Pin the server version with an upgrade checklist: process control.
- Fuzz the BFF against the live server and assert denials: catches reachability, not intent.
**Recommendation:** Option 1 together with an exact server pin in compose.
**Challenges:** Story 6 "path map and role checks agree".

## Q4 [Impl] There is no stable repository id in the code today
The spec binds grants, favourites, metadata, lineage and audit to a stable repository id, but authorisation currently resolves roles from `namespace/repo` names, and PAT scopes store names. Adding the id is a data migration across every store, plus a request-time lookup from path to id on every call. During the migration, a name that resolves to two ids or none must fail closed. Nobody has defined where the id is minted for repositories that already exist in oxen.
**Example:** 1,200 existing repositories exist only as oxen directories. The migration assigns ids at first sight; two instances do it concurrently and two ids are created for `genomics/panel-a`.
**Options:**
- Mint ids in the Main database with a unique constraint on current name and a one-off backfill: safe, requires a migration window.
- Derive the id lazily at first request: no window, race-prone.
- Mint ids at repository creation only and block old ones until backfilled: simple, blocks users.
**Recommendation:** Option 1, with a reconciliation report of oxen repositories vs id rows before enabling enforcement.
**Challenges:** "Authorization references stable repository ids" (new infrastructure, not existing).

## Q5 [Impl] Name reuse after delete or rename can inherit someone else's grants
If grants key on id, deleting `team/panel-a` and recreating `team/panel-a` must not inherit old collaborators. If a rename moves the id, a new repository created at the old name must not inherit grants, favourites or PAT scopes still stored by name. Rename is copy+delete at the BFF, so there is a moment when two directories exist and the name map is in flux.
**Example:** `oncology/trial-9` is renamed to `oncology/trial-9-final`. A newcomer immediately creates `oncology/trial-9`, and a PAT scoped by name to the old repository now grants write on the new one.
**Options:**
- Everything references the id, names are a unique alias table with tombstones: correct, all stores change.
- Reserve old names for N days after rename: partial mitigation.
- Forbid creating a name that was ever used: strict, ugly.
**Recommendation:** Option 1 with Option 2 as a courtesy so old clone URLs fail rather than silently pointing elsewhere.
**Challenges:** Story 12 and "Renames are copy+delete … keep the id".

## Q6 [Domain] Transfer destination rule is unconfirmed, and the code has no transfer
The spec says transfer needs repo admin plus destination namespace write, "to be confirmed in code". Searching the BFF finds no transfer concept at all, so the rule would be new behaviour, not a check of existing behaviour. Write access in the destination is also weaker than what the destination Owners would consent to: they inherit a repository they did not accept, including its collaborators and data.
**Example:** A repo Admin in `research` holds Write in `clinical-ops`. She transfers a repo containing unblinded data into `clinical-ops`, whose Owners never agreed, and its old collaborators keep access.
**Options:**
- Require source admin and destination Owner approval (two-step): safe, slower.
- Require destination Owner only to create, then source admin to push: mirrors GitHub-like behaviour.
- Disallow transfer; use rename and manual migration: smallest surface.
**Recommendation:** Option 1; decide what happens to collaborators (drop by default).
**Challenges:** "Transfer destination checks: require repo admin and destination write, to be confirmed".

## Q7 [Impl] Last-owner and last-admin guards race across N instances
The guards that stop removing the last Owner or last instance admin are check-then-write. With a single process the check and write sit together; with N instances two Owners removing each other at the same moment both pass. The same applies to demotion and to the revocation of a sole Owner (Q23). Database constraints or locking are required but not specified.
**Example:** Owners Kim and Raj each remove the other within 50 ms through different instances. Both checks see two Owners; the namespace ends up with none and nobody can fix it except an instance admin.
**Options:**
- Row lock on the namespace during membership changes: simple, serialises edits.
- Deferred constraint counting owners at commit: declarative, harder to express.
- Optimistic version number on the namespace: scales, needs retry.
**Recommendation:** Option 1; add a two-instance concurrency test.
**Challenges:** Decision D10 "last guards" under the multi-instance requirement.

## Q8 [Domain] Instance admin site-admin bypass is unrestricted write access to GxP data
An instance admin passes every check, audited after the fact as a bypass. There is no reason prompt, no second approver, and no distinction between reading and altering. Annex 11 §12 and §9 expect privileged access to be controlled and monitored. An admin who is also a scientist can edit validated data and sign.
**Example:** The platform admin, who is not a member of `clinical`, edits the final results file at 23:00. The audit shows a bypass event, which nobody reads before the report is submitted.
**Options:**
- Split admin: platform admin (no data access) versus data admin, bypass for reads only with reason: closest to separation of duties.
- Bypass requires a reason and step-up, writes allowed: records intent, still powerful.
- Time-boxed elevation approved by a second admin: strongest, process overhead.
**Recommendation:** Option 1 for strict deployments, with Option 2 minimum everywhere.
**Challenges:** D2 "Site-admin bypass; audit each as `site_admin_bypass`".

## Q9 [Impl] Auditing every bypass or denial interacts with strict fail-closed and volume
A bypass is audited per request. Reads are high-volume (listings, tree views), and under strict mode an Intent event must be stored before the request proceeds. An admin browsing 200 repositories can generate thousands of immutable events. If immudb is slow, admin reads fail with 503, and decision events could swamp useful audit signal.
**Example:** The admin opens the repository list; each row's permission check records a bypass, producing 1,200 events before the page renders.
**Options:**
- Audit bypass only on mutations and on first read per repository per hour: bounded volume.
- Audit every bypass, both Intent and Outcome: complete, noisy.
- Audit bypass reads in an operational log, mutations in immudb: practical, weaker evidence.
**Recommendation:** Option 1; define the sampling rule in the spec so auditors know what absence means.
**Challenges:** "Audit each as `site_admin_bypass`" with "GXP_STRICT for ALL mutations".

## Q10 [Domain] Namespace Owner holds implicit Admin on every repository and can grant freely
An Owner is Admin on all current and future repositories and can add collaborators, including outside collaborators. No approval or notification to data owners exists. In a regulated sponsor/CRO setting the person who controls the namespace is often an administrator, not the data owner, and should not be able to add themselves or others to restricted repositories silently.
**Example:** The IT-run namespace Owner adds an external consultant as Write on a blinded efficacy repository, with no input from the study lead.
**Options:**
- Granting Write/Maintain/Admin on repositories tagged restricted needs approval from a named repository data owner: clear accountability.
- Owners lose implicit repo Admin; they only manage membership: least privilege, breaks the GitHub-like model.
- Keep but notify repository Admins on every new grant: visibility only.
**Recommendation:** Option 3 now, Option 1 for restricted repositories.
**Challenges:** D5 "Namespace Owner on repos: implicit Admin".

## Q11 [Domain] No access reviews and no breakglass expiry
Access-review campaigns and mandatory expiry for delegated permissions are out of scope. Annex 11 and ISO 27001 auditors will ask for periodic review of who can access GxP systems, usually annually or quarterly. With retention forever and no expiry, grants accumulate for years, particularly for outside collaborators and custom roles.
**Example:** A CRO consultant given Write for a two-month study still holds it three years later. During an inspection, the company cannot show any review.
**Options:**
- Built-in review report with attestation events: audit-ready, medium build.
- Mandatory expiry on outside collaborators and delegated instance permissions: preventive, simple.
- Manual export and spreadsheet review under SOP: no build.
**Recommendation:** Option 2 immediately, Option 1 next; revisit "out of scope" as it is a common inspection finding.
**Challenges:** "Scheduled access review campaigns and mandatory breakglass expiry are not included".

## Q12 [Domain] Stale group claims: the only immediate remedy is revoking everything
Group membership is snapshotted at login and at PAT mint; removing a group binding only works if the access came from a binding. Revoking a Principal kills every credential, so it is disproportionate for a team move. Admins will not use it and access lingers. The earlier plan listed this as open; the decision records the heavy hammer as the answer.
**Example:** Nina leaves the "bioinformatics" IdP group on Monday and keeps write access to 14 repositories via a PAT until it expires 80 days later.
**Options:**
- Re-resolve groups from the directory on a short cache for Sessions and PATs: closes gap, IdP dependency.
- Narrow revoke: "refresh groups" action that invalidates only group-derived grants: precise, more mechanics.
- Keep as decided and document: no cost.
**Recommendation:** Option 2 with a visible admin action, falling back to Option 1 if directory outage is acceptable.
**Challenges:** "admin revoke per iss+sub is the group-revocation path".

## Q13 [Impl] Group binding keys are names and IdP claims can be incomplete
Bindings use IdP group names, not group ids and not the issuer. Names can be renamed, duplicated across issuers, or differ in case. Some IdPs omit groups above a count limit. A rename in the IdP silently removes access, and an attacker who can create a group with the same name in the IdP gains it.
**Example:** The identity team renames "Lab-Oncology" to "Lab-Oncology-EU". All 60 members lose access at their next login with no change in Mice.
**Options:**
- Bind to immutable group ids with `iss`, display names cached: robust, needs directory lookups for admin UX.
- Keep names and normalise case: simple, fragile.
- Bind names but alert when a bound group stops appearing in any claim: detection only.
**Recommendation:** Option 1 with Option 3 as a safety net.
**Challenges:** "Group claims come from the Session or PAT snapshot".

## Q14 [Impl] Role changes are not atomic with in-flight long requests
Authorisation is evaluated at the start of a request. Chunked uploads, imports and long downloads span many requests or minutes. A grant removed mid-upload may still let the remaining chunks land; a Write role revoked after the first chunk but before the commit is registered. In a multi-instance setup with caches the effective time of a change is not defined.
**Example:** A 40 GB upload begins with Write. At chunk 12 of 40 the Write grant is removed; chunks 13–40 and the final publish succeed.
**Options:**
- Re-authorise on each chunk and on publish, with no caching beyond a few seconds: correct, more reads.
- Authorise once and bind to an upload token with short expiry: cheap, bounded window.
- Authorise once, accept: simplest, wrong.
**Recommendation:** Option 1 for publish (the commit step) and Option 2 for chunks.
**Challenges:** "Chunked upload and import routes are explicitly classified at repo write".

## Q15 [Impl] Authorisation lookups on every request plus listings and search leaks
Each request resolves namespace membership, groups, collaborators, custom roles and repository id. Listings ("repositories I can see"), the favourites page and the dedicated search engine (a derived index) each need to filter by access, not just authorise a single path. If the search index returns hits from repositories the caller cannot read, that is an access bypass even though the BFF default-deny holds.
**Example:** A search for "patient 4471" returns snippet titles from a restricted repository because the index was built without per-repository ACL filters.
**Options:**
- Index with repository id and filter results post-query by an authorisation check: correct, pagination gets awkward.
- Pre-filter with allowed repository ids passed to the engine: efficient, large id lists for admins.
- Per-user indexes: unscalable.
**Recommendation:** Option 2 with a cap, falling back to Option 1 for admins; add an explicit leakage test.
**Challenges:** Cross-cutting "dedicated search engine as derived index" meets authorisation (not mentioned in the spec).

## Q16 [Domain] Auditors and inspectors need read-only access and there is no role for them
The only broad-visibility roles are instance admin (full write via bypass) and `view_audit` (audit logs only). An internal QA auditor or a regulator needs to read repositories, history and audit evidence without being able to modify anything, ideally time-boxed. Giving them instance admin violates separation of duties; giving them repository Read everywhere needs a grant per repository.
**Example:** An FDA inspector arrives for a three-day visit. QA must grant read on 90 repositories one by one, or hand over admin.
**Options:**
- A predefined read-only "auditor" instance permission with expiry: purpose-built, new catalog entry.
- Namespace-level Read via base permission for a group: existing mechanism, broad and manual.
- Provide exported evidence packages only: no live access, heavy for inspectors.
**Recommendation:** Option 1, always read-only with a mandatory end date and audited use.
**Challenges:** New gap (instance permission catalog).

## Q17 [Domain] Repository is the finest granularity, and nothing protects branches
The model grants roles per repository. There is no branch protection or path restriction, so Write can push directly to `main`, which would make "Merge+maintain is the review gate" bypassable. Sensitive data inside one repository (raw subject data next to summary tables) cannot be separated. Oxen datasets often mix both.
**Example:** A Write user pushes a commit straight to `main` with a modified result file; the maintain-gated merge path was never exercised.
**Options:**
- Protected branch rule enforced at the BFF: only merges (with maintain) can move protected branches: closes the gap, needs ref awareness.
- Enforce by convention and audit detection: cheap, after the fact.
- Split sensitive data into separate repositories: no build, organisational burden.
**Recommendation:** Option 1 for repositories flagged GxP; Option 3 as guidance.
**Challenges:** "Merge+maintain is the review gate" (a gate that exists only for merges).

## Q18 [Domain] "Members can create repositories" and repository Admin sharing power
Default is that any namespace Member may create a repository and becomes its Admin, and a repository Admin can then add outside collaborators. Combined, any Member can share new data with anyone in the directory, with no data-owner involvement. Visibility follows oxen public/private; whether a public repository is ever acceptable on a GxP instance is unspecified.
**Example:** A Member creates `scratch/export`, copies a restricted dataset into it, and adds a personal collaborator. No approval was needed at any point.
**Options:**
- Default off for creating repositories in regulated namespaces; sharing external collaborators requires Owner approval: controlled, friction.
- Keep defaults but notify Owners of every new external collaborator: visibility.
- Disallow public repositories on the instance entirely: simple and safe.
**Recommendation:** Option 3 plus Option 2; make "default on" an explicit choice per namespace.
**Challenges:** D7 "Members create repos default on; creator gets Admin".

## Q19 [Impl] Scoped PATs do not behave as "narrowing only"
Story 9 says a scope only narrows. In the code, scoped PATs lose custom-role grants and the instance-admin path and are refused on several routes, which is neither pure narrowing nor widening, but a different rule set. If custom roles contain fine permissions such as job submit, a scoped PAT cannot use them. Scopes are keyed by names, so a rename moves them. Service principals, in scope now, will depend on these semantics.
**Example:** A CI PAT scoped to `trial-9` with max role write should submit Jobs because the owner's custom role grants job submit; the call is denied.
**Options:**
- Evaluate scoped credentials as intersection(user effective grants, scope) uniformly, including fine permissions: matches the story, rewrite of checks.
- Keep exceptions but document each route that refuses scoped credentials: explicit, error-prone.
- Replace role caps with explicit action grants per PAT: clearer, bigger.
**Recommendation:** Option 1 with a table-driven test over all routes; keep the refusals as a list of per-user routes.
**Challenges:** Story 9 versus code behaviour.

## Q20 [Impl] The `stage` rename and custom-role migration in a rolling multi-instance deployment
Authorisation actions move from the old workspace name to `stage`, with aliases and migrated custom roles. During a rolling deploy, some instances know both names and some only the old. Roles stored with new names can deny on an old instance, and an alias window with no end date means permanent ambiguity. Historical audit events keep the old action names.
**Example:** During the deploy, instance B (old) receives a request from a custom role "Stage runner" stored with `stage.*` actions and denies; users see random 403s depending on the instance.
**Options:**
- Two-phase release: ship alias reading first, migrate data second, drop aliases after N weeks: safe, longer.
- Single migration with a maintenance window: simple, downtime.
- Dual-write both names during the window: smooth, doubles complexity.
**Recommendation:** Option 1 with a dated alias removal and an audit query that maps old to new names.
**Challenges:** "Stage naming/authz migration" with N instances.

## Q21 [Domain] Service principal access governance and the review gate
Service principals are governed like users. The spec does not say whether they may hold maintain, merge, or Admin, nor whether they can be members of groups or namespaces. A pipeline principal with maintain can merge its own outputs, so the review gate is satisfied by automation, and the "owner" human never saw the change.
**Example:** `qc-nightly` has maintain to merge its report branch. It merges without human review, and the merge is signed by nobody.
**Options:**
- Service principals capped at Write; merge and signature-bearing actions require a human: preserves the gate.
- Allow maintain but require a named human approval before merge: workable, new flow.
- No restrictions, documented: weak.
**Recommendation:** Option 1.
**Challenges:** Story 10 "service principal's access governed like a user's".

## Q22 [Impl] Explaining decisions without leaking existence
Story 7 wants denials to name the missing permission yet not leak whether a resource exists; story 13 wants admins to see why a decision was made. Returning 403 for existing and 404 for missing repositories discloses names; the explanation endpoint can leak group names and role structure. The hard gate (pending page) reveals nothing today, and error bodies, timing and listing counts are further channels.
**Example:** A user probes `clinical/study-x-unblinded`: 403 "requires write" proves the repository exists and that "write" is the missing tier.
**Options:**
- Uniform 404 for anything the caller cannot read; explanation only for resources they can read: no leak, less helpful.
- 403 with a generic "ask your admin" message and a separate request-access path by id: some leak.
- Detailed explanation only to admins through a dedicated decision-trace endpoint: best of both.
**Recommendation:** Options 1 and 3 together.
**Challenges:** Story 7 vs 13 and the hard-gate behaviour.

## Q23 [Domain] Orphaned namespaces when the only Owner is revoked
The last-Owner guard prevents removal of the Owner row, but revoking or suspending the Principal behind it leaves a namespace nobody can administer. The "reviewer escalation target" is still unresolved, so access requests also have nobody to approve them. Manual offboarding makes this likely: the leaver's credentials die, the namespace silently has no working owner.
**Example:** The only Owner of `immunology` is offboarded. Three new hires request access and the requests go to a revoked reviewer; only an instance admin can intervene.
**Options:**
- Require at least two Owners per namespace, with an alert when fewer active ones exist: robust.
- Auto-escalate to instance admins after N days: simple, adds noise.
- Allow Owners to be groups: resilient, relies on group freshness.
**Recommendation:** Options 1 and 2; define the escalation target now because it was left unresolved.
**Challenges:** D10 "last guards" and "reviewer escalation target" unresolved.

## Q24 [Domain] Namespace deletion deletes repositories by default under "retention forever"
Namespace deletion removes AuthZ and, by default, all repositories. The cross-cutting decision keeps all records forever. These conflict: deleting a namespace destroys data that GxP rules require you to retain (typically years after study closure), and under strict mode the deletion needs only an Owner.
**Example:** An Owner tidies up and deletes the `stability-2019` namespace; 3 TB of study data is gone, backups are deferred, and the audit event only says "deleted".
**Options:**
- Soft-delete with a retention hold and admin-only purge after a defined period: aligned, storage kept.
- Require step-up plus a second admin to delete a namespace that has commits: protective.
- Keep default true: fast cleanup, dangerous.
**Recommendation:** Options 1 and 2; default `deleteRepositories` to false.
**Challenges:** "Retention forever" versus the deletion default in the plan.

## Q25 [Domain] Training gate may be self-attested
The code offers a training gate where a user can mark themselves complete ("self/admin complete"). Part 11 §11.10(i) requires that people have the training for their tasks, and a self-click is weak evidence. The spec does not mention the gate at all, yet the code enforces it when the flag is set.
**Example:** A new hire clicks "training complete" on day one and gains access to a GxP namespace.
**Options:**
- Only a QA-designated role or an LMS integration can record completion: credible evidence.
- Self-attestation plus manager confirmation: light.
- Remove the gate from the respec and rely on SOP: smallest.
**Recommendation:** Option 1 with the completion recorded as an audited event naming the recorder.
**Challenges:** New gap (existing behaviour omitted by the spec).

## Q26 [Impl] Testing the role × action × credential matrix
The spec asks for black-box tests per role and action against real containers. With five roles, custom roles, base permissions, groups, Owners, scoped PATs, service principals and about a hundred routes, the matrix is thousands of combinations. Tests that stand up Postgres, immudb and the search engine per case are slow, and permissions are cached differently per instance.
**Example:** 5 roles × 120 actions × 4 credential kinds = 2,400 cases at roughly 300 ms each is 12 minutes serial, before running twice for two instances.
**Options:**
- Table-driven generated matrix with a shared fixture and unique ids, run on two instances: complete, needs discipline.
- Sampled critical paths plus property tests (role monotonicity: higher role never loses access): faster, less complete.
- Unit-level matrix for the pure resolver plus a thinner HTTP set: quick, but off the declared test seam.
**Recommendation:** Option 1 for CI nightly, Option 2 for per-commit runs; assert monotonicity as a property.
**Challenges:** Cross-cutting testing seam "tests at BFF HTTP boundary" for a matrix this size.

## Q27 [Impl] Permission changes under strict mode and Intent events
Every grant, revoke and role change needs an Intent event first, and fails closed with 503 when the store is unavailable. That means an outage of the audit store stops access removal, the exact operation that contains an incident. It also applies to custom-role edits. The Outcome of a grant change should include the full before/after resolved permission set, which is not specified.
**Example:** During an immudb outage an Owner cannot remove a compromised collaborator, and the grant stays active until storage recovers.
**Options:**
- Allow removals and demotions during audit outage, queue an Intent record in the Main database: containment first, bends the rule.
- Fail closed for everything: consistent, incident-hostile.
- Fail closed for grants, open for revocations: asymmetric and justified.
**Recommendation:** Option 3 with a durable outbox so the audit trail is completed afterwards.
**Challenges:** "GXP_STRICT fail-closed for ALL mutations".

## Q28 [Domain] Namespace-scoped audit for Owners vs cross-namespace events
Owners may query audit only within their namespace and instance-wide needs `view_audit`. Real events cross boundaries: transfers, renames, merges between forks, service principals acting in several namespaces, and grants made by instance admins. An Owner of the source sees half the story; deleted users and deleted repositories also lose their namespace association. Server-side filtering must be correct, because a leak exposes other namespaces' activity.
**Example:** A repository is transferred from `research` to `clinical`. The `research` Owner's audit view ends at the transfer, and the destination Owner cannot see the origin history.
**Options:**
- Events tagged with every involved namespace id so each Owner sees their side: clear rule.
- Cross-namespace events visible only to `view_audit` holders: simple, opaque to Owners.
- Include the repository id history regardless of namespace for the current Owner: transparent, wider exposure.
**Recommendation:** Option 1 and tests that assert that a third namespace sees nothing.
**Challenges:** D9 "Audit query: ns-scoped only" with transfers and rename.

## Decisions log

| Q | Answer | Date |
| --- | --- | --- |
| Q1 | Forbid self-merge everywhere, no override (every repo needs ≥2 eligible mergers) | answered |
| Q2 | Deny every unclassified route; update ADR 0002; parity test fails on new route | answered |
| Q3 | Contract test enumerating routes of pinned oxen + exact server pin | answered |
| Q4 | Repo ids assigned at creation in one transaction; reconciliation report for pre-existing repos | answered |
| Q5 | Grants/favorites/scopes keyed by repo id only; recreated name gets new id; old name 404/410 for a period | answered |
| Q6 | Transfer needs source repo admin + destination namespace Owner approval; collaborators dropped by default | answered |
| Q7 | Last-owner/admin guards via DB constraints/locking + two-instance test | answered |
| Q8 | Instance admin has no data access by default; elevation with reason, time-box, second approver in strict, audited intent; read vs write distinguished | answered |
| Q9 | Individual audit for bypass mutations and sensitive reads; routine listing reads as one summary event per page/session | answered |
| Q10 | Namespace Owner gets Admin but restricted/GxP repo collaborator grants need data owner approval/notification | answered |
| Q11 | Mandatory expiry on outside/delegated grants AND scheduled access-review campaigns, both now | answered |
| Q12 | Re-check directory groups on use with max staleness; admin refresh action | answered |
| Q13 | Bind groups on IdP group id + issuer; warn on disappeared group; fail loudly on missing claims | answered |
| Q14 | Re-authorize at each chunk and at publish, cached within staleness bound | answered |
| Q15 | Server-side filter all listings/search/counts/activity/favorites; leakage test per list endpoint | answered |
| Q16 | Add read-only time-boxed audited Auditor/Inspector role | answered |
| Q17 | Only main protected globally (as chosen; note: force-push/delete of other released branches unprotected) | answered |
| Q18 | Members create repos only where Owner allows; default private to creator + namespace admins | answered |
| Q19 | Moot: no PATs; credentials scoped to repo id+action, intersected with live permissions | answered |
| Q20 | Inherited (new project, no rolling-deploy concern) | answered |
| Q21 | Inherited (service principals removed) | answered |
| Q22 | 404 for no-read, 403 for visible-but-forbidden; reason codes only in audit/Admin; consistent timing | answered |
| Q23 | Block removing last Owner; offboarded Owner => instance admins + alert + mandatory new Owner within N days | answered |
| Q24 | No hard delete; archive only; audit and lineage retained | answered |
| Q25 | Training not yet implemented: out of scope for now; do not build self-attestation; revisit | answered |
| Q26 | Generated route×role×state matrix at BFF boundary + targeted tests | answered |
| Q27 | Inherited (absolute fail-closed) | answered |
| Q28 | Events carry namespaces+repo ids; namespace view shows only fully-visible events; cross-namespace for instance auditors | answered |

---

# Known Issues and Conflicts

## Caching and staleness conflicts
- **Q12 (staleness-bounded directory re-check) versus 15 Q21 (no cache, per-request revocation read) and 01 Q4 (about 2 s cache)**: CONFLICT on caching strategy. A single staleness figure must be reconciled across 01 (Authentication), 02 (Authorization) and 15 (Administration). Authentication round 3 Q79 resolves to no revocation cache, but group staleness remains unaligned.

## Cross-module audit and summarization conflicts
- **Q9 (routine listing reads summarized) versus 00 Q4 (all reads audited)**: Reconciled only if the summary event counts as the audit record. Requires confirmation in 03 (Audit) that summary events satisfy regulatory requirements for read accountability.

## Review gate and role conflicts
- **Q1 (forbid self-merge, needs two eligible mergers per repository)**: Small repositories cannot merge until a second maintainer exists. Conflicts with 04 Q18 (escalation unconfirmed) – if no second merger exists, escalation has no target.
- **Q8 (second approver in strict) versus 15 Q6 (second approver for elevation)**: Now consistent since strict is always on (global decision), but requires at least two admins per instance for separation of duties.

## Repository identity and migration conflicts
- **Q4 (pre-existing repositories need reconciliation report)**: 16 Q24 says the pilot is wiped, so this may be moot. No migration from name-keyed to id-keyed stores is promised.
- **Q6 and 05 Q10 (transfer is BFF metadata change with no oxen move)**: PENDING confirmation that oxen paths do not embed the namespace. With static physical keys by stable id (05 Q25) this should hold.

## Service principal and credential removal
- **Q21 and Q19 (PATs and service principals removed)**: 07 (CLI), 09 (Jobs) and 12-14 (other specs) still reference them in places. Need cleanup across:
  - 07: CLI no longer mints PATs; short-lived credentials only
  - 09: Jobs use BFF-internal tokens tied to submitting user
  - 12-14: Remove service principal references from metadata, sessions, notifications

## Training and access review deferrals
- **Q25 (training gating deferred, no self-attestation built)**: Impacts ability to enforce qualification-based access. See authentication S4 (training spec needed).
- **Q11 (access reviews and mandatory expiry)**: Revisited in authentication S3 (quarterly access review) and must be implemented for regulatory compliance.

## Classification and route coverage
- **Q2 and 05 Q17, 11 Q25 (unclassified routes denied)**: Lineage classification failure must create a gap operation rather than allowing bypass. Every new oxen route must be explicitly classified.

# Impact on Other Specs

## Blocks or dependencies
- **Blocks 04 (GxP Compliance)**: The merge signer must differ from the author (Q1); every GxP repository needs at least two eligible mergers. Reviewer escalation (04 Q18) depends on having a second merger available.
- **Blocks 05 (Repositories)**: Transfer destination approval (Q6) and branch protection (Q17) decisions apply to repository lifecycle operations.
- **Blocks 09 (Jobs)**: Service principal removal (Q21) means Jobs must use BFF-internal tokens; credential scoping (Q19) defines how job submissions are authorized.
- **Depends on 01 (Authentication)**: Group staleness (Q12), credential scoping (Q19), and revocation timing (01 Q3/Q4) define authorization check freshness.
- **Depends on 05 (Repositories)**: Stable repository ids (Q4) must exist before authorization can reference them; rename behavior (05 Q25) affects grant persistence.

## Cross-cutting impacts
- **01 (Authentication)**: Group re-checking frequency (Q12) must align with authentication staleness bounds (01 Q18, round 3 Q71).
- **03 (Audit)**: Audit summarization strategy (Q9) for routine reads versus individual events for bypass/sensitive operations defines audit volume and query patterns.
- **05 (Repositories)**: Repository stable ids (inherited Q1, 02 Q4) are foundational; rename as metadata-only change (05 Q25) keeps grants intact.
- **08 (Workspaces)**: Authorization re-check on lease renewal (Q14) applies to workspace write leases.
- **11 (Lineage)**: Unclassified routes (Q2) impact lineage capture; if a route is denied, no lineage edge is created.
- **12 (Metadata/Search)**: Search filtering (Q15) and favorites filtering (02 Q9 referenced in 13 Q9) must never leak unauthorized repository visibility.
- **13 (Favorites)**: Server-side filtering (Q15) ensures favorites list shows only accessible repositories.
- **15 (Administration)**: Instance admin bypass restrictions (Q8), auditor role (Q16), and namespace deletion rules (Q24) define administrative authorization boundaries.

