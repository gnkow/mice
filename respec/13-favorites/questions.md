# 13 — Favorites: grilling questions

Status: spec is ready-for-agent; a first version exists (store, routes, web stars, CLI) but jobs ordering only works on the first page, and several promises (purge on delete, rename survival, strict-mode behaviour) have no mechanism yet.
Biggest risks: "not audited" contradicting the all-mutations-fail-closed rule, favorites quietly becoming notification routing for regulated events, and server-side ordering plus purge being racy across N BFF instances.

## Q1 [Domain] Is toggling a favorite a mutation under strict mode, and must it be audited?
The favorites plan states they are not audited because they are personal UI state. The cross-cutting decision says every mutation fails closed with 503 when its Intent event cannot be appended, with no exempt class. Either favorites are exempt (contradicting the rule an auditor was told is uniform) or every star click needs an Intent and Outcome event in immudb. Both have a price: validation documents with an exception, or immudb writes for trivia and an outage that stops starring.
Example scenario: immudb is down for 10 minutes during a shift change. Scientists click stars on jobs and receive 503s, though the same action in the unfinished design says "personal state, not audited".
Options:
- Declare favorites an explicit exempt class with a rationale in the validation plan — fast, breaks the "no class exempt" statement.
- Audit every toggle — uniform, high volume, little value.
- Audit only when the favorite influences notification routing — fine-grained, complex.
Recommendation: Exempt favorites explicitly and amend the cross-cutting rule to name the exemption with criteria (no regulated data, no access effect).
Challenges: Plan D7 "not audited" versus cross-cutting "GXP_STRICT fail-closed for ALL mutations".

## Q2 [Domain] What is a favorite allowed to influence in regulated work?
Spec calls favorites "a hint for notifications" and the plan makes a star an implicit watch. If a star changes who is told about a failed Job or a pending merge, it becomes part of the platform's behaviour that affects regulated processes, yet it is unaudited, personal and mutable. A user who stars a job and later removes the star changes what they were told with no trace.
Example scenario: Reviewer Omar stars repository "acme/stability" to follow merges. Later he unstars it for tidiness and misses a merge request notice; the audit shows only that the notice was not sent to him.
Options:
- Favorites are purely UI ordering and never feed notifications — clean separation, loses the hint.
- Favorites feed notifications only for non-regulated categories — limited, needs classification.
- Separate explicit watch control, favorites affect nothing — clear semantics, one more control.
Recommendation: Make favorites UI-only; introduce explicit watch in Notifications when needed.
Challenges: Spec problem statement ("a hint for notifications") and plan section 7.

## Q3 [Domain] What does a star mean for notifications when every category is on by default and favorites never bypass a disabled category?
All categories default on and all accessible resources notify by default. A favorite is described as an implicit watch with lowest precedence that cannot override a disabled category or any mute. The combination leaves the star with no effect in every case: allowed events already notify, and the only blocked cases stay blocked.
Example scenario: User Mia stars job J-2201 expecting alerts, but her notification category for jobs is disabled. Nothing arrives; the settings page still says "Favorites notify by default".
Options:
- Remove the implicit watch rule and the settings hint — honest, drops a decision.
- Let favorites enable only their own resource's events despite a category being off — useful, contradicts category semantics.
- Keep as documentation only — misleading.
Recommendation: Remove the claim; favorites do not affect notifications until an explicit watch exists.
Challenges: Plan decision D10, Q3 answer, and the spec story 12.

## Q4 [Impl] How does favorites-first ordering stay correct across pages when the list is cursor-paginated?
The plan promises server-side ordering across pages but the current implementation applies favorites only when no cursor is present, pinning favorites to the first page. A two-group order (favorites then the rest, each sorted) requires a composite cursor, and favorites change between page requests.
Example scenario: User has 3 favorite jobs among 4,000. On page 1 they appear first; he unstars one on page 2 navigation, and the cursor based on the old group boundary now repeats or skips two jobs.
Options:
- Composite keyset (group flag, created time, id) with the group evaluated at query start and embedded in the cursor — stable within a scan.
- Return all favorites in a separate first response and continue paging non-favorites — simpler cursor, two calls.
- Offset paging — easy, unstable on writes.
Recommendation: Embed a favorites version stamp in the cursor; reject and restart if it changed.
Challenges: Story 3 and the Implementation Decision "favorites=first parameter now", versus the first-page-only behaviour in code.

## Q5 [Impl] What does the favorites join cost on large jobs and sessions tables with N instances?
Server-side ordering joins the caller's favorites to jobs or sessions. With retention forever, the jobs table grows without bound, and a user can have up to 10,000 favorites. Without the right composite indexes the join runs per request on each instance.
Example scenario: 8 million jobs, a user with 6,000 favorite jobs; listing the second page must sort two groups and filter by repository access in a single query that takes 4 seconds.
Options:
- Index on owner key and entity id, and cap favorites per type (for example 1,000) — bounded.
- Denormalise a per-user favorites bitmap — fast, heavy to maintain.
- Order only the first page and offer a favorites filter — cheap, the original compromise.
Recommendation: Cap per type, measure at 10M jobs, and keep the join keyed on indexed ids.
Challenges: Decision "Add favorites=first parameter to job and session list endpoints now".

## Q6 [Impl] How does the branch favorite identify a branch after a copy-plus-delete rename?
Branch favorites are per repository and keyed by repository id plus branch name. A rename of the repository keeps the id but recreates it by copy; branches might be recreated, renamed or reordered. Branch deletion and recreation under the same name also keeps old favorites alive.
Example scenario: User stars branch "feature/assay-7" on repository r_81f. The branch is deleted and a different colleague creates a new "feature/assay-7"; the star points at an unrelated branch.
Options:
- Keep the name key and accept reuse — simple, misleading.
- Store the branch head commit at favorite time and mark mismatches — detects reuse, complexity.
- Drop branch favorites from scope — least risk, removes a story.
Recommendation: Keep name keys, purge on branch-delete events, and show the current head commit in the profile panel.
Challenges: Story 5, story 7 and cross-cutting rename decision.

## Q7 [Impl] How can purge-on-delete via the audit observer be multi-instance safe and complete?
Deletion events are observed from audit, which lives in immudb, plus a periodic sweep. The observer needs a stored position, exactly-one-processor semantics across instances, handling of Intent events without Outcome, and treatment of deletions performed directly in oxen that never reach the BFF.
Example scenario: Instance B crashes after reading an outcome "repo deleted" but before deleting 420 favorites; instance A starts from its own cursor and processes the same event; the sweep later checks 2 million favorites against oxen one by one.
Options:
- Lease-based single consumer with durable cursor plus idempotent deletes — standard, requires a lease table.
- Delete in the same request that performs the repository delete — immediate, bypassed by external deletes and may fail midway.
- Sweep only, by joining to a Main database list of repositories — simplest for repositories, nothing for oxen-only branches.
Recommendation: Durable cursor consumer with leases, idempotent purge keyed by stable id, and a sweep restricted to ids present in the Main database.
Challenges: Decision "Purge on delete via the audit observer plus sweep, multi-instance safe".

## Q8 [Impl] What happens when a favorite is added concurrently with the deletion of its entity?
Add validates existence, then writes; delete publishes an event that purges. If the add commits after the purge, the favorite survives for a deleted entity until the sweep. With a stable repository id this ghost never resolves.
Example scenario: At 10:00:00.200 user adds a favorite on job J-77; at 10:00:00.100 the job was deleted and the purge ran at .150; the add's existence check read from a cache saying the job exists.
Options:
- Foreign keys to a Main database entity table for repository, job and session types — impossible for branches and stages kept in oxen.
- Re-validate on read and drop confirmed 404s — eventual repair, costs lookups.
- Tombstone table for deleted ids consulted at insert — closes the race, grows.
Recommendation: Foreign keys where entities exist in the Main database, read-time validation for oxen-resident types, and a periodic sweep.
Challenges: Plan section 4 "Existence validated on add via cache" and the story 6.

## Q9 [Domain] Is "hide on lost access, purge on delete" distinguishable without leaking existence?
The user wants deleted favorites purged while a favorite on a resource that lost access is hidden and returns when access returns. To purge, the system must tell deletion from access loss, and the add call responds 404 versus 403 depending on the case. That difference reveals existence of entities a user cannot read.
Example scenario: Intern Jo tries to favorite "acme/secret-trial" through the API. 403 means it exists; 404 means it does not; the intern enumerates repository names.
Options:
- Always answer 404 for unreadable and nonexistent — no leak, ambiguous for legit mistakes.
- Keep 403 for namespaces visible in the instance, 404 otherwise — mirrors AuthZ rules.
- Allow the add for any syntactically valid id and filter at read — never leaks, creates junk.
Recommendation: Use the AuthZ decision convention already used for repositories (404 where existence is private) for all entity types.
Challenges: Plan section 4 (404 if missing, 403 if cannot read) and story 6.

## Q10 [Domain] May an admin see other people's favorites, and what does story 10 actually mean?
Story 10 reads "I want to see favorites for entities I can read through admin rights". Plan Q4 is about whose favorites an admin sees; the text suggests an admin's own favorites resolve on entities readable only via admin rights. Showing another user's list reveals interests and work patterns, a workplace-privacy and data-protection matter.
Example scenario: Admin Chen opens a user's profile in the admin area and sees that scientist Pia starred a competing-lab repository and a job named "layoff-model".
Options:
- Favorites are visible only to their owner; admin reads own list with admin-readable entities — minimal privacy.
- Admins may read others' favorites with an audited reason — useful for support, intrusive.
- No admin access at all — strict, support must reproduce.
Recommendation: Owner-only visibility; the story means the admin's own favorites include admin-readable entities.
Challenges: Story 10, plan Q4 and "Cluster-visible admins see favorites on entities they can read".

## Q11 [Domain] Where do favorites go when a person's Principal changes?
A Principal is the issuer plus subject. Changing IdP, a reorganised directory or a re-created account produces a new Principal, and favorites are lost. The owner accepted this, yet an IdP migration is a one-time event that affects every user simultaneously, and manual offboarding keeps the old Principal's favorites forever.
Example scenario: The company moves from Okta to Entra in March. 600 users lose favorites; the old Principals remain in the Main database with 30,000 favorite rows and no owner.
Options:
- Accept and document; a rebind admin tool copies favorites per migration — controlled, build once.
- Automatic email-based linking — convenient, an account-takeover risk.
- Store favorites against a platform user id that maps to multiple Principals — clean, new concept.
Recommendation: Accept the loss, provide an audited admin migration of favorites during an IdP migration, and purge rows of revoked Principals after a defined period.
Challenges: Story 11 and "retention forever".

## Q12 [Domain] Do service principals and automation get favorites?
Service principals are in scope now and use PATs. A scoped PAT is rejected by the favorites routes, and automation has no UI. Cross-cutting retention and the CLI mean a script could create thousands of favorites for a service principal.
Example scenario: A CI service principal runs "favorite add" for every job it submits, producing 90,000 rows in a month.
Options:
- Principals of kind service cannot hold favorites — simple, explicit.
- Allow with the same ceiling — uniform, pointless rows.
- Allow only through a dedicated PAT scope — controlled, more scopes.
Recommendation: Reject favorites for service principals with a clear error.
Challenges: "Service principals in scope now" and plan section 4 PAT rule.

## Q13 [Impl] What should the hard ceiling and list contract be?
Product says unlimited; the plan sets a defensive ceiling of 10,000 per user and a lookup cap of 500 references, and the list endpoint returns everything. Under the no-limit promise a power user can hit the ceiling silently, and an unpaginated response of 10,000 rows with a read check each is heavy.
Example scenario: A user with 8,500 favorites opens the profile; the list API checks read access for each against oxen and takes 25 seconds.
Options:
- Paginate the list and compute access with a batched check — scalable, API shape change.
- Lower the ceiling to a few hundred per type and say so — honest, changes D4.
- Cache access decisions per request — faster, stale-risk.
Recommendation: Paginate with a per-type cursor, batch access checks and publish the ceiling.
Challenges: Decision D4 "Unlimited" versus the defensive hard ceiling.

## Q14 [Domain] What does the favorite type "stage" refer to, given the glossary has Workspace, Staging and Stage?
The glossary defines Workspace as the Mice overlay tree and Staging as Oxen's server-side area. The cross-cutting decision makes Stage the user-facing name for an Oxen workspace, and the spec says legacy "workspace" favorites are read as "stage". It is unclear whether a favorite on a Mice Workspace is intended, or whether old entries refer to the thing being renamed.
Example scenario: User has a favorite of type workspace pointing at an overlay tree called "ws-91". After migration it appears as a stage in the CLI list, linking to a page that no longer exists.
Options:
- Favorites cover both kinds with distinct types — complete, more UI.
- Favorites cover stages only and workspace favorites are dropped — clean, loses data.
- Map legacy workspace to stage where ids match, else drop — pragmatic, lossy.
Recommendation: Define both entities separately; map only when the identity resolves, and report dropped favorites to the user.
Challenges: Story 8 and cross-cutting "Stage naming/authz migration".

## Q15 [Domain] Does "Favorites first" as default order undermine repeatable review work?
Favorites first is the default sort on every list. Reviewers and auditors compare lists across people and over time, and in validation scripts a screenshot or ordering is expected to be deterministic. A per-user default alters the visible order silently.
Example scenario: An inspector asks two employees for the list of recent jobs; the lists differ in order because one has stars, and the inspector believes data differs.
Options:
- Default to Newest and make Favorites first opt-in — predictable, lower adoption.
- Keep default but show an indicator and sort label — transparent, subtle.
- Default by list type: only navigation lists use it — compromise, inconsistent.
Recommendation: Default to the list's natural order for jobs and sessions, favorites-first for navigation lists, always labelled.
Challenges: Plan D3 and story 2.

## Q16 [Domain] Does starring ephemeral jobs and Desktop Sessions make sense?
Jobs are numerous and sessions are temporary; retention is forever and purge only on delete. A star on a job nobody deletes lives forever, and favorites on a stopped Desktop Session may point at nothing useful.
Example scenario: A scientist stars 40 jobs during a month-long study; the profile tab shows 40 stale jobs ordered by star time and no way to filter by repository.
Options:
- Keep but auto-hide finished items after a period — keeps data, adds rules.
- Allow stars only on durable entities (repository, namespace, branch) — focused.
- Replace with "saved views" over lists — richer, new feature.
Recommendation: Keep jobs, drop Desktop Sessions, and add a per-type cap.
Challenges: Plan D1 entities and "retention forever".

## Q17 [Domain] How do the existing browser-local repository star and the new server favorite coexist?
The plan notes the repository header keeps a browser-local star beside the new server favorite. Users will have two stars with different meanings, and local data never reaches another device or the CLI.
Example scenario: A user has 15 local stars; after the upgrade the profile shows none, and the user thinks the migration lost data.
Options:
- Import local stars into server favorites once at first login — smooth, client logic.
- Remove the local star — clear, abrupt.
- Keep both — confusing.
Recommendation: One-time import with a prompt, then remove the local star.
Challenges: Plan implementation status note.

## Q18 [Impl] What are the API contract and concurrency rules for add and remove?
Add and remove use a request body on PUT and DELETE, which some proxies and clients drop. Two tabs toggling, the optimistic web client and the CLI can disagree, and idempotence responses need definition. With N instances there is no process-local state allowed.
Example scenario: The CLI deletes a favorite with a body through a corporate proxy that strips DELETE bodies, receiving 400 with no effect.
Options:
- Identify the favorite by a path or query identifier — proxy-safe.
- Explicit set operation with the desired state and a version — idempotent, concurrent-safe.
- Keep body-based and document — least change.
Recommendation: Path-addressed resources with stable ids and a PUT-with-state semantic.
Challenges: Plan section 4 API.

## Q19 [Impl] What is the data model and key in the Main database?
The existing key is a serialised issuer-subject pair. Entity references are strings by type, some in oxen (branch, stage) and some in the Main database. With "no data to preserve", the schema can be designed fresh, but referential integrity, indexes and migration from stored JSON are open.
Example scenario: A composite text key costs 120 bytes per row; at 10 million rows indexes grow large and a rename of a Principal's issuer URL would require rewriting rows.
Options:
- Internal principal id as a foreign key plus entity type and reference — compact, requires a principal table.
- Keep issuer and subject columns — simple, wide.
- Hash the pair — compact, opaque to debugging.
Recommendation: Principal table with an internal id and foreign key, unique on (principal, type, entity ref).
Challenges: Decision "Keyed by Principal (iss+sub) and entity reference using stable repository id".

## Q20 [Impl] How are read-access checks batched for the profile panel and the bulk lookup?
Both the favorites list and the lookup endpoint run an access check per entity, by type, through different gates (repository read, job read, session owner). A user with 500 entities across 200 repositories turns one request into hundreds of checks and possibly oxen calls.
Example scenario: The lookup of 500 references while rendering a jobs page takes 1.8 seconds because each reference calls a different gate; the page flickers.
Options:
- Group by repository and check once per repository — big win for repository-bound types.
- Cache decisions per request and per principal for seconds — fast, stale window.
- Evaluate access in SQL — fastest, duplicates authorization logic.
Recommendation: Group by repository id and reuse the central decision module with request-level caching.
Challenges: Plan section 4 shared canReadEntity helper.

## Q21 [Impl] Which recipients does the notification worker use: favorites at event time or at replay time?
Favorites are computed at delivery time and not stored with the event. A replay from audit after a crash would apply the current favorites to an old event, so recipients differ between the original run and the replay, and a late replay might notify someone who starred afterwards.
Example scenario: Job fails at 10:00; worker crashes; replay at 10:20 after a user starred the job at 10:10 sends that user a notice for an event that preceded the star.
Options:
- Resolve recipients once and store them with the event — deterministic, storage per event.
- Resolve on replay and ignore star times newer than the event — deterministic from timestamps, requires favorite creation time.
- Accept variance — simple.
Recommendation: Persist the resolved recipient list per event, and stop deriving recipients from favorites at all if Q2 is accepted.
Challenges: Plan section 7 "computed at delivery time" and the replay requirement.

## Q22 [Impl] What is the CLI contract for ids and output?
CLI is exact-version pinned and Node-only. Ids follow a grammar and "inside a clone: bare branch/repo allowed", which uses local context to infer references. With rename and stable ids, a clone's remote name may be stale, and output format is a public contract for scripts.
Example scenario: A script runs "favorite add repo" inside a clone whose remote still points to the old name after a rename; the CLI favorites the wrong repository or fails ambiguously.
Options:
- Require explicit stable ids in scripts and allow inference only interactively — safe.
- Resolve by remote and always print the resolved stable id — transparent.
- Drop inference — simple.
Recommendation: Print the resolved identity and require confirmation flags in non-interactive mode.
Challenges: Plan section 8 and the user story 9.

## Q23 [Domain] Do favorites survive repository transfer without exposing the new location?
Favorites should survive rename and transfer by stable id. After a transfer to another namespace, the user may lose access under the new namespace's rules; hidden favorites then keep the repository's id but the profile shows nothing, and an unhidden favorite shows the new namespace to someone who could previously read.
Example scenario: Repository moves from "research" to "clinical-restricted". Scientist Ivo's favorite should disappear because he lost access, but the profile count briefly shows 1 and the link reveals the new name.
Options:
- Apply the access check before computing counts and labels — correct, cost per read.
- Remove favorites on transfer for users without access — destructive.
- Hide on mismatch and restore on regained access — plan default.
Recommendation: Keep hide-and-restore, compute counts only from visible entries.
Challenges: Story 7 and D6 hidden-not-deleted.

## Q24 [Domain] Does hiding (not deleting) favorites on lost access retain data of departed users?
Hidden favorites remain forever by retention rule. A user whose access is revoked still has a row tying them to the resource, which is an indirect record that the user once cared about the resource (for example a restricted study).
Example scenario: A contractor favorited "acme/oncology-7"; a GDPR access request returns favorites that include the restricted study's name though access was removed.
Options:
- Delete favorites after a grace period of lost access — tidy, loses "returns if access returns".
- Keep and treat the table as user personal data subject to export — compliant, more tooling.
- Keep and ignore — risk.
Recommendation: Keep for 90 days of lost access, then delete, and include favorites in a user data export.
Challenges: Decision D6 and "retention forever".

## Q25 [Impl] How does the web client behave when the favorites service is slow or down?
Stars appear in every list row via a bulk lookup; a Main database outage returns 503 and lists should still render. An optimistic toggle with rollback needs an error path, and the lookup cap of 500 may be exceeded on large pages.
Example scenario: The lookup endpoint times out during a database failover; the jobs list shows a spinner for 30 seconds instead of rows without stars.
Options:
- Render lists without stars when the lookup fails and retry in the background — resilient.
- Block the list until the lookup returns — consistent, fragile.
- Return favorites flags inline in the list API — one request, couples endpoints.
Recommendation: Inline favorite flags for jobs and sessions lists, graceful degradation elsewhere.
Challenges: Plan section 5 "one bulk lookup per list page".

## Q26 [Impl] How do BFF HTTP tests prove purge, ordering and multi-instance behaviour?
Tests must stay black-box at the BFF HTTP boundary with unique ids and two instances. Purge on delete is asynchronous through the audit observer and the sweep, and cursor ordering depends on the favorites version.
Example scenario: A test deletes a repository on instance A and asserts the favorite is gone on instance B immediately; it passes 90% of the time.
Options:
- Provide a deterministic purge-complete signal in the delete response or a test hook — exact, a product concession.
- Poll with a timeout — simple, flaky risk.
- Make purge synchronous with the delete — strongest, couples failure modes.
Recommendation: Synchronous purge for entities in the Main database, asynchronous only for oxen-resident types, and tests polling with a bounded timeout against the latter.
Challenges: Cross-cutting testing decision and the plan's test list.

## Decisions log

| Q | Answer | Date |
| --- | --- | --- |
| Q1 | Audit only if toggle affects notification routing (otherwise exempt); amend 00 Q3 | answered |
| Q2 | Favorites feed notifications (as planned) — CONFLICT with Q3 | answered |
| Q3 | Remove implicit-watch claim and settings hint — CONFLICT with Q2; resolve in 14 | answered |
| Q4 | Composite keyset cursor + favorites version stamp | answered |
| Q5 | Index (owner,entity id), per-type cap 1,000, measure 10M | answered |
| Q6 | Name key; purge on branch delete; show head | answered |
| Q7 | Lease consumer, durable cursor, idempotent purge by stable id, Main-DB sweep | answered |
| Q8 | FKs for Main-DB entities, read-time validation oxen-resident, sweep | answered |
| Q9 | 404 for unreadable and nonexistent | answered |
| Q10 | Owner-only; admin's own list incl. admin-readable | answered |
| Q11 | Accept loss; audited admin migration tool; purge revoked after period | answered |
| Q12 | N/A SPs removed; reject for internal principals | answered |
| Q13 | Paginated, per-type cursor, batched checks, published ceiling | answered |
| Q14 | Both types distinct; map if resolves; report dropped | answered |
| Q15 | Keep default order with indicator/label | answered |
| Q16 | Keep jobs, drop Desktop Sessions, per-type cap | answered |
| Q17 | Remove local star (no import) | answered |
| Q18 | Path-addressed, stable ids, PUT-with-state | answered |
| Q19 | Principal table FK; unique (principal,type,ref) | answered |
| Q20 | Group by repo, central module, request cache | answered |
| Q21 | Persist resolved recipients per event | answered |
| Q22 | Print resolved id; explicit id/confirm non-interactive | answered |
| Q23 | Hide-and-restore; counts from visible only | answered |
| Q24 | Keep and ignore (RISK flagged: GDPR/data-retention for lost-access favorites) | answered |
| Q25 | Inline flags in jobs/sessions list; degrade elsewhere | answered |
| Q26 | Sync purge Main-DB; async oxen-resident; bounded polling | answered |
