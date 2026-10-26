# 01 — Authentication: grilling questions

Status: spec is `ready-for-agent`, but it was written "as if unbuilt" while the code already ships back-channel logout, directory-sync revocation, step-up and service principals. 28 questions follow.
Biggest risks: manual-only offboarding with PATs that outlive the IdP account; `GXP_STRICT` fail-closed colliding with revocation itself; step-up that does not prove who re-authenticated or how strongly; stateless sealed cookies that cannot be listed, rotated or sized.
Tags: [Domain] = regulated-workflow/compliance concern, [Impl] = engineering concern.

## Q1 [Domain] Manual-only offboarding has no owner, no trigger and no SLA
The spec says admins revoke by `iss`+`sub` and that this is "documented", but nothing says who learns that a person left, how fast, or how the admin proves it was done. Part 11 §11.10(d) and Annex 11 §12 expect access to be limited to authorised individuals at all times, and an inspector will ask for the leaver-to-revoked interval. The IdP account is disabled by HR, yet Mice only sees that at the next login, and a PAT never logs in again.
**Example:** Dr. Okafor's contract ends Friday 17:00. HR disables her IdP account at 17:05. Nobody tells the Mice admin. Her laptop still holds a PAT with 84 days left and pushes a modified assay dataset on Sunday.
**Options:**
- Written SOP plus a required admin checklist with a recorded revoke event: cheap, relies on people.
- Keep SCIM out but add a periodic "IdP-disabled vs active Principal" report for admins: detects drift without automation.
- Reinstate directory-sync revocation (already coded): automated, but contradicts the "no directory sync" decision.
**Recommendation:** Option 2 at minimum, with a named role and a maximum leaver-to-revoke interval in the SOP; the cross-cutting "no directory sync" call is the weakest decision here.
**Challenges:** "Offboarding is manual and documented; no SCIM or directory sync" (spec 01 and cross-cutting).

## Q2 [Impl] The spec ignores code that already exists
The spec lists back-channel logout and directory sync as out of scope, yet the BFF already contains both, with tests and a second "sessions-only" cut-off. The respec rule "plans are intent only" does not say whether existing behaviour is deleted, kept dormant, or kept as supported. Leaving it ambiguous means a validation engineer cannot tell what the system actually does. Dormant code with live endpoints is also attack surface.
**Example:** The IdP is configured to send back-channel logout for `sub` X. The BFF accepts it and revokes sessions only. The spec says the feature does not exist, so no test, SOP or risk assessment covers it.
**Options:**
- Remove the code to match the spec: smallest surface, loses working capability.
- Adopt it into the spec as supported behaviour: honest, expands validated scope.
- Keep it behind an off-by-default flag, documented as unsupported: ambiguous validation status.
**Recommendation:** Decide explicitly per feature; adopt back-channel logout (sessions-only) into the spec because it is cheap and correct, and decide directory sync under Q1.
**Challenges:** Spec 01 "Out of Scope: directory sync, back-channel logout" versus code reality.

## Q3 [Impl] Revocation cut-off has one-second granularity and uses the instance clock
The cut-off is stored in whole epoch seconds and a credential is rejected when its issue time is less than or equal to it. The value comes from each BFF instance's own clock, not from the Main database. With N instances, clock skew of two seconds decides whether a credential minted just after a revoke is rejected, and a re-login in the same second as the revoke is rejected too. For a security control that is meant to be "immediate", this is an unstated tolerance.
**Example:** Admin revokes at 10:00:00.9 on instance A. Instance B's clock reads 10:00:02. The user, still holding a stolen cookie issued at 10:00:01 by instance B, passes the check because 10:00:01 is later than the stored cut-off.
**Options:**
- Take the cut-off from database time and store a monotonic revocation generation per Principal: exact, one extra column.
- Keep seconds and mandate NTP with a documented skew bound: cheap, residual window.
- Compare credential issue-generation to revocation-generation instead of timestamps: robust, requires re-sealing existing credentials.
**Recommendation:** Option 1; define "immediate" in the spec as a measurable bound (for example, effective on all instances within 1 s of commit).
**Challenges:** "Revocation uses a not-valid-before cut-off per Principal; rejected on every instance".

## Q4 [Impl] Every request reads the Main database to check revocation
Each authenticated request performs a revocation lookup, and PAT use also updates a last-used timestamp on the token row. At moderate load (say 200 scientists plus CI at 50 requests/s) that is a hot-path read on every call and a hot-row write per token. The usual fix, a per-instance cache, directly weakens the "immediate on every instance" promise. The spec states both requirements and never reconciles them.
**Example:** A Job fleet of 300 containers using one service principal PAT pushes results at once. Every call updates the same last-used row, producing lock contention and slowing unrelated users.
**Options:**
- Cache revocation with a short TTL (for example 2 s) and state it as the guarantee: fast, bounded staleness.
- Push invalidation by database notification to all instances: near-immediate, more machinery.
- Keep uncached reads and write last-used at most once per minute: simple, adds query load.
**Recommendation:** Option 1 plus throttled last-used writes; write the staleness bound into the validation docs.
**Challenges:** "PATs and Sessions created at or before it are rejected on every instance" with no latency target.

## Q5 [Domain] PATs survive the IdP account for up to 365 days
A PAT is validated only against Mice's own store, never against the IdP. Disabling or deleting the IdP account, an IdP-side logout, or back-channel logout does not affect it; the spec explicitly keeps PATs alive after logout. Annex 11 expects credentials to be invalidated when the person's authorisation ends. Capping at 365 days does not solve a leaver problem, only a forgotten-token problem.
**Example:** A postdoc moves to a competitor in March. IdP account disabled; her PAT (minted in January, 365-day expiry) keeps cloning the proprietary compound library until January next year unless an admin remembers.
**Options:**
- Bind PAT validity to periodic IdP re-validation (refresh token or directory check): closes the gap, adds IdP dependency on the hot path.
- Shorten PAT maximum to 30 days with rotation: limits blast radius, annoys CI owners.
- Accept and rely on Q1's SOP: no engineering, high residual risk.
**Recommendation:** Option 2 for humans (30–90 days max), and revisit Option 1 only if directory checks are reinstated.
**Challenges:** "PATs follow the human rules (default 90 days, max 365)" and "logout is not offboarding".

## Q6 [Domain] Step-up proves a recent login, not that the signer is the account holder
Step-up re-authentication sends the browser to the IdP with a maximum age and then checks that the new `auth_time` is recent. The IdP may satisfy `max_age` from an existing IdP session without a fresh prompt, and some IdPs ignore the parameter. Nothing checks that the identity authenticated at the IdP is the same `sub` as the Session, nor the assurance level (password only versus MFA). Part 11 §11.200 requires the signer to execute two distinct identification components at signing, and §11.100 binds the signature to one individual.
**Example:** Ana walks away from an unlocked workstation. A colleague clicks "Sign" in her Session. The IdP, which keeps an 8-hour SSO session for whoever last logged in at that browser, either returns immediately (ignoring `max_age`) or prompts, and the colleague logs in as herself. If the BFF only checks that `auth_time` is recent and does not compare the returned `sub` with the Session's `sub`, a fresh login by the colleague satisfies the check and the signature is attributed to Ana.
**Options:**
- Force `prompt=login`, require same `iss`+`sub`, and require `acr`/`amr` evidence: strongest, depends on IdP support.
- Force `prompt=login` and same `sub` only: good and portable.
- Keep `max_age` only: weakest, relies on IdP behaviour.
**Recommendation:** Option 2 as mandatory, Option 1 where the IdP exposes `acr`; document the IdP requirements.
**Challenges:** "Step-up: a reauthentication mechanism with max-age check".

## Q7 [Impl] Step-up compares IdP time to the BFF clock
The freshness test subtracts the IdP-issued `auth_time` from the local clock of whichever BFF instance handles the request. IdP and BFF clocks drift, and N instances drift from each other. A negative age passes, and a small positive skew can make a legitimately fresh sign-in look stale and cause a redirect loop in front of an e-signature. Separately, the maximum age is capped at 24 hours, which would let a "fresh" signature rest on yesterday's login.
**Example:** The IdP clock is 40 s behind. A signer authenticates, returns, and the BFF computes age as 340 s against a 300 s limit; the signer is bounced to the IdP again and again.
**Options:**
- Record the time of callback receipt at the BFF as the freshness anchor, ignore IdP `auth_time` except for ordering: skew-proof.
- Allow a configured skew tolerance (for example 60 s): simple, small weakening.
- Cap max-age at 15 minutes for signatures: stricter, more prompts.
**Recommendation:** Option 1 together with a hard cap of 5–15 minutes for signing purposes.
**Challenges:** "Step-up: max-age check" (no skew, no upper bound defined).

## Q8 [Domain] Step-up cannot work for CLI or Job-originated signatures
Step-up works only for a browser Session; a PAT can never satisfy it. The cross-cutting decision says the maintain user signs at merge, and merge is also performed from the CLI, Python and automation. A scientist merging from the terminal either cannot sign or signs through a back-door path. The spec does not say which surfaces may perform a signature-bearing merge.
**Example:** Priya merges `exp-42` into `main` using the CLI, as she does 20 times a week. The merge is the regulated review gate, but the BFF cannot demand fresh authentication on a PAT call.
**Options:**
- Signature-bearing actions are web-only; CLI returns a "sign in the browser" link: clean evidence, slower workflow.
- CLI step-up through the device flow with a fresh IdP login: same UX everywhere, more build.
- Allow PAT merges with no signature: breaks the Part 11 story.
**Recommendation:** Option 2 using the existing device flow, falling back to Option 1 until built.
**Challenges:** "Step-up consumed by GxP e-signatures" versus PAT automation (and "identical behaviour from web, CLI and API").

## Q9 [Impl] Unsigned id_tokens are acceptable outside strict mode
ADR 0001 accepts the id_token without signature verification; the plan proposes enabling signature checks only under `GXP_STRICT`. The spec adds "external IdP required in production" but does not make signature verification mandatory there. A misconfigured reverse proxy, a plain HTTP token endpoint or an intercepting corporate proxy would make unsigned tokens forgeable. The ADR's justification (direct TLS from the token endpoint) is a deployment assumption, not an enforced property.
**Example:** A TLS-inspecting proxy at a pharma site rewrites the token response. The BFF accepts an id_token whose `sub` is the instance admin's, because only claims are checked.
**Options:**
- Make JWKS verification mandatory in all non-development environments: removes the assumption, small cost.
- Mandatory only under strict: leaves non-strict production open.
- Keep the ADR: cheapest, weakest.
**Recommendation:** Option 1 and supersede ADR 0001 with a new ADR; also require an https issuer.
**Challenges:** ADR 0001 and "id_token accepted without signature" carried into the respec.

## Q10 [Domain] Author injection ties history to mutable name and email
Commit authors are written from IdP name and email, while identity is `iss`+`sub`. Names change (marriage), emails get reassigned to new hires, and oxen records only name and email, not `sub`. Years later, reading the commit alone cannot distinguish two people who held the same address. ALCOA+ "attributable" requires a stable link, and the Mice side must be able to resolve it.
**Example:** `j.smith@lab.com` belonged to John Smith until 2024 and then to Jane Smith. A 2023 commit and a 2025 commit show the same author, and an auditor asks who authored the 2023 one.
**Options:**
- Store `sub` in the Outcome event for every mutation and resolve commits via audit: attributable, requires audit lookup.
- Add the Principal key to the commit message trailer: self-contained, visible to users and spoofable unless injected.
- Freeze the name/email snapshot per Principal at first use and never update: stable, stale.
**Recommendation:** Option 1 plus Option 2 as an injected, signed-by-BFF trailer, so the git history stays self-describing.
**Challenges:** "Author injection" attributes by email/name only.

## Q11 [Domain] No path for the same person to change IdP or `sub`
Story 14 treats a different `sub` or IdP as a distinct Principal and never merges. That is safe, but real events happen: an IdP migration from Okta to Entra changes every `sub`, a company acquisition changes the issuer, a person is re-created in the directory. All memberships, collaborator roles, favourites, owned service principals and signing history appear to belong to a stranger. Without a controlled link, admins will recreate grants by hand, and the original history is orphaned.
**Example:** The company moves IdPs over a weekend. 400 scientists log in Monday as new Principals with zero grants, hitting the pending page, and 40 service principals have owners that no longer exist.
**Options:**
- Audited, dual-approved "identity migration" admin action mapping old key to new key: preserves history, new privileged operation.
- Bulk re-grant by script with audit: no new feature, loses continuity.
- Reject IdP changes as unsupported: honest, strands customers.
**Recommendation:** Option 1, with both keys retained in audit so attribution stays unambiguous and no silent merging happens.
**Challenges:** Story 14 / "no cross-IdP merging".

## Q12 [Domain] Service principals and GxP attribution of automated actions
Service principals are in scope now: admin-created, one human owner, suspended when the owner is revoked. Part 11 and Annex 11 require that automated records identify the responsible person and the process. Suspension on owner offboarding means validated pipelines fail at an arbitrary time, and reassignment is not defined. Nothing says whether a service principal may merge, sign or approve.
**Example:** The nightly QC pipeline runs as service principal `qc-nightly`, owned by Tom. Tom leaves; the principal is suspended at 02:00 mid-run, leaving a half-written result and an Intent event with no outcome.
**Options:**
- Require owner plus a named backup owner and make reassignment an audited admin action: continuity, more governance.
- Suspend and require reassignment before any run: safest, outage risk.
- Orphan to a team owner (group): resilient, weaker accountability.
**Recommendation:** Option 1; additionally forbid service principals from signature-bearing and review-gate actions.
**Challenges:** "Service principals … suspended automatically when the owner is revoked" with no reassignment or signing rule.

## Q13 [Impl] Owner revocation cascading to service principals is a distributed transaction
The owner is revoked by setting a cut-off on the owner's Principal key, and service principals must be suspended as a consequence. The spec does not say whether suspension is one transaction, an asynchronous job, or checked lazily at use. With N instances, a service principal can mint a PAT between the owner's revoke and the suspension. Lazy checking costs an owner lookup on every service request.
**Example:** At 10:00:00 the admin revokes Tom. At 10:00:01 the CI system, using a still-valid service PAT, mints a fresh 90-day PAT for the same principal; the suspension job runs at 10:00:05.
**Options:**
- Single database transaction writing the owner cut-off and the suspended flag together: atomic, couples the stores.
- Lazy check of owner status on every service request: always correct, extra read.
- Asynchronous suspension with a reconciliation loop: eventually consistent, window exists.
**Recommendation:** Option 1, plus Option 2 as a safety net, since requests can race the transaction.
**Challenges:** Story 12 "suspended automatically when owner is revoked" (no mechanism or ordering).

## Q14 [Domain] PATs on scientists' machines are stored in plaintext config
The CLI keychain is out of scope, and the documented flow puts the PAT into the oxen client config on disk. Laptops get lost, shared HPC login nodes are readable by admins, and backups copy home directories. A GxP lab has to answer for credential storage under Annex 11 §12. A leaked PAT looks exactly like the owner, including on signature-adjacent actions.
**Example:** A scientist's laptop is stolen from a conference. The PAT is in a dotfile; the thief clones three repos before the owner notices the next morning.
**Options:**
- Accept plaintext but ship short lifetimes plus per-PAT IP allow-lists: limited exposure, config burden.
- Add OS keychain support to the Node CLI now: best practice, the CLI is pinned and Node-only so feasible.
- Make PATs device-bound via the device flow with refresh: strong, much larger build.
**Recommendation:** Option 2 on macOS/Linux; record the plaintext fallback as an accepted, documented risk.
**Challenges:** "Out of scope: keychain storage in the CLI".

## Q15 [Impl] Device-flow login is a known phishing target
The CLI device flow lets an attacker start a login and talk a user into approving a short code. The spec only says "device flow" and that approval needs an instance permission. Rate limits, code entropy, expiry, polling limits and the displayed context (who, from where, which CLI) matter, and with N instances the counters must be shared. The approval page is a high-value social-engineering surface.
**Example:** An attacker emails "your IT needs you to verify code BCDF-WXYZ". The scientist, already signed in, approves; the attacker's terminal receives a 90-day PAT.
**Options:**
- Show requester IP, client name and a confirm-by-typing step; expiry 5 minutes: fair friction.
- Add an admin policy to restrict device approval by network range: strong, config burden.
- Require step-up before approval: strongest, makes approval slower.
**Recommendation:** Options 1 and 3 combined; counters held in the Main database.
**Challenges:** "As a CLI user, I want to log in through a device flow" (no abuse controls).

## Q16 [Impl] Stateless sealed cookies cannot be listed, selectively revoked, or safely rotated
A Session is a sealed cookie with no server-side record, so the only revocation is a per-Principal cut-off that kills every device. With N instances all share the sealing secret; compromise of that secret forges any Principal, including the admin. The spec does not describe key rotation. The group snapshot inside the cookie also grows with membership.
**Example:** An admin learns the sealing secret leaked through a debug log. Rotating it logs out all 600 users at once, and there is no tool to roll keys gradually.
**Options:**
- Support two active keys (current and previous) with a rotation procedure: gradual, small change.
- Add a server-side session table: per-device revoke and listing, reverses a design decision and adds a hot read.
- Keep as is and document emergency rotation: cheapest, outage on rotation.
**Recommendation:** Option 1 now; reconsider Option 2 only if per-device revoke becomes a requirement.
**Challenges:** "Sessions are sealed cookies" with no rotation or size rule.

## Q17 [Impl] Group snapshot in the cookie meets cookie size and IdP claim limits
Group names are snapshotted into the Session at login. Browsers cap a cookie around 4 KB, and some IdPs (Entra, for instance) omit the group claim when a user has too many groups and send an overage pointer instead. The BFF either truncates silently, fails the login, or issues a cookie that is dropped by the browser. Authorisation then depends on data that is incomplete.
**Example:** A principal in 230 groups logs in. The claim is missing, so the Session carries no groups and she silently loses all group-derived access, or the sealed cookie exceeds the limit and the browser discards it, producing a login loop.
**Options:**
- Store groups server-side keyed by session generation and keep the cookie small: robust, adds state.
- Fetch groups from the directory at login on overage: correct, adds an IdP dependency.
- Fail login explicitly with a clear admin-facing error when the claim is truncated: safe, annoying.
**Recommendation:** Option 3 immediately, Option 2 as the real fix.
**Challenges:** "Group claims are snapshotted at login and at PAT mint".

## Q18 [Domain] Stale group membership stays effective for the whole Session or PAT life
The spec accepts that someone removed from an IdP group keeps the access until re-login or revoke, and "admin revoke per iss+sub" is the answer. That kills every credential, so it is disproportionate for a routine team move, and admins will not do it for a single group change. A person removed from a blinded-study group keeps access for the absolute Session lifetime or up to a year on a PAT.
**Example:** A statistician moves off Study 7 on Monday. IdP group removed. On Thursday she still opens unblinded randomisation lists via her 90-day PAT.
**Options:**
- Re-check groups against the directory on each Session refresh and PAT use with a short cache: closes the gap, IdP dependency.
- Make Session absolute lifetime short (for example 8 h) and PAT groups re-evaluated daily: bounded staleness.
- Keep as documented: no cost, high residual risk for restricted data.
**Recommendation:** Option 2 with a stated maximum staleness, and flag restricted repositories as requiring direct grants rather than group bindings.
**Challenges:** "Stale IdP group membership remains effective until revoke or re-login; documented consequence".

## Q19 [Domain] Session idle timeout and absolute lifetime have no specified values
The spec says "expire after inactivity" and the strict-mode rule refuses idle timeout of zero, but no default, maximum or absolute lifetime is given. Part 11 and typical lab SOPs expect lock-out on unattended sessions; shared instruments in a lab are the high-risk case. Another unanswered point is who owns the value in validated deployments.
**Example:** A cleanroom workstation stays logged in over a weekend because idle is zero in a non-strict test instance that was later promoted to production.
**Options:**
- Defaults of 15 min idle and 12 h absolute, configurable only downwards in strict mode: predictable.
- No defaults, validation owner sets them: flexible, drift risk.
- Different values per client (web vs Desktop Session): precise, complex.
**Recommendation:** Option 1 with the values written into the spec and tested.
**Challenges:** Story 2 and "plans treated as intent only" (no numbers carried over).

## Q20 [Domain] What happens to running Jobs and Desktop Sessions when a Principal is revoked
Revocation rejects credentials at the BFF, but Jobs already running and Desktop Sessions connected over RDP hold no BFF credential in use. Offboarding is only complete if those stop too. The spec lists Sessions and PATs only. A leaver's running Job can still write results and a Desktop Session keeps mounting a Workspace.
**Example:** Revoked at 14:00, Marcus's Desktop Session remains open on the RDP port and his 6-hour training Job finishes at 19:00, committing results under his name.
**Options:**
- Revoke cascades: stop Jobs and terminate Desktop Sessions of the Principal: complete, destructive of work.
- Suspend and freeze for admin review, outputs preserved: safer for data, more states.
- Leave running, flag for review: simplest, offboarding incomplete.
**Recommendation:** Option 2; define the cascade in the spec, because "immediately" is otherwise only true at the BFF.
**Challenges:** Story 6 "offboarding takes effect immediately".

## Q21 [Impl] `GXP_STRICT` fail-closed meets the revoke action itself
Under strict mode every mutation needs its Intent event stored first, and 503 otherwise. Revoking a Principal, minting a PAT and logging in are mutations. If the audit store (immudb) is down during an incident, an admin cannot revoke a compromised Principal, and nobody can log in. The cross-cutting "no exemptions" rule produces a lockout exactly when containment is needed.
**Example:** At 03:10 immudb is unreachable during a suspected credential leak. The admin presses "Revoke" and gets 503; the attacker keeps working because existing credentials remain valid.
**Options:**
- Exempt revocation and logout from strict fail-closed but queue a durable local record reconciled later: contains incident, bends the rule.
- Keep strict for all, with a documented emergency procedure (rotate sealing key / disable IdP): consistent, blunt.
- Write Intent to the Main database as a durable outbox and forward to immudb: both safe and available, new component.
**Recommendation:** Option 3, otherwise Option 1 for revocation only, recorded as a deliberate deviation in the validation documents.
**Challenges:** "GXP_STRICT fail-closed for ALL mutations".

## Q22 [Domain] No emergency access when the external IdP is down
External IdP is required in production and Keycloak is development-only. If the IdP has an outage, nobody can log in, including instance admins; running experiments cannot be paused or audited. Regulated labs plan for IdP outage in business continuity. The spec has neither a break-glass admin nor an offline procedure.
**Example:** The corporate IdP is unavailable for four hours during a stability study sampling window; the sampling results cannot be uploaded and the scientist writes them on paper with no controlled path to enter them later.
**Options:**
- Audited, time-boxed break-glass local admin credential held in a safe: workable, creates a weak credential.
- Allow existing Sessions to continue, block only new logins: no new credential, limited relief.
- Accept outage and document paper fallback: no engineering, SOP burden.
**Recommendation:** Option 2 by default plus a documented paper fallback; break-glass only if the sponsor demands it.
**Challenges:** "Keycloak dev-only, external IdP required" (no continuity plan).

## Q23 [Domain] Completeness of authentication audit: failures, context and privacy
Story 8 audits login, logout, failures, mint and revoke. IdP-side failures (wrong password) never reach Mice, so a failed-login trail is only partial. Auditing every 401 into the immutable store also invites log flooding, and retention is "forever", so IP addresses and user agents are held permanently. GDPR erasure and works-council rules conflict with immutable storage of personal data.
**Example:** A scanner sends 50,000 requests with bad PATs; each produces an immudb entry containing source IP, and the store grows by 30 MB per hour.
**Options:**
- Audit security-relevant failures with rate-limited aggregation and pseudonymised network data: bounded growth, less raw detail.
- Audit everything verbatim: simplest, flood and privacy exposure.
- Store failures in the Main database with TTL, only successes and admin actions in immudb: practical, splits evidence.
**Recommendation:** Option 1; state which authentication events are GxP records and which are operational logs.
**Challenges:** Story 8 and "retention forever".

## Q24 [Impl] Rate limiting and lockout for token endpoints across N instances
Nothing in the spec limits bad PAT guesses, bad device codes, login callback replays or mint calls. With N instances, in-process limiters do not add up. Hashed PAT lookup is cheap, so an attacker can try many tokens per second. The consequence of a limiter that fails open or closed under database load also needs deciding.
**Example:** A bot tries 1,000 `mice_pat_` guesses per second against three instances; each instance allows 300 per second and nothing alerts.
**Options:**
- Shared counters in the Main database or Redis with per-IP and per-prefix limits: correct, new load.
- Rely on the ingress/WAF: no code, no application insight.
- Per-instance limits only: weak under N instances.
**Recommendation:** Option 2 as baseline plus Option 1 for the device-flow and mint endpoints.
**Challenges:** New gap.

## Q25 [Impl] Bootstrap admin and first-boot races on N instances
The first instance admin is created when a matching login arrives and no admin exists. With N instances starting together, two simultaneous logins can both see "no admins". Matching by verified email is also reassignment-prone. If every admin is later revoked or deleted, there is no recovery except redeploying configuration.
**Example:** Two founders listed in the bootstrap list log in within the same second on different instances and each is created as the sole admin; the last-admin guard then protects whichever row survives.
**Options:**
- Database advisory lock and a unique "bootstrapped" marker: race-free, trivial.
- Match bootstrap only on `iss`+`sub`, never email: removes reassignment risk, harder to configure before first login.
- Recovery command line action run by an operator with host access: admin-lockout path.
**Recommendation:** Options 1 and 3, Option 2 once the first admin exists.
**Challenges:** "Bootstrap admin matches `iss`+`sub` or verified email" and the single-process assumptions.

## Q26 [Impl] Existing credentials and stores must migrate without a flag day
The code and ADR 0001 mention stores keyed on bare `sub`, grandfathered PATs expiring 365 days after migration, and a token store that was file-based. The respec treats all of this as void and rebuilds on PostgreSQL. No one has said what happens to live PATs, sealed cookies and revocation cut-offs on cutover, nor whether the hash scheme and secret stay compatible. A botched move silently re-enables revoked credentials.
**Example:** Revocation cut-offs for 12 leavers are not migrated. On cutover day their old PATs, which were rejected before, become valid again.
**Options:**
- Migrate hashes, expiries and cut-offs with a verification script and dry run: continuity, effort.
- Invalidate everything at cutover and re-issue: simplest, users and CI re-onboard.
- Run old and new stores in parallel for a window: safe, double complexity.
**Recommendation:** Option 1, with revocation records migrated first and a reconciliation report signed off; fall back to Option 2 for PATs older than the migration.
**Challenges:** "Treat plans as intent only … every JSON store reference is void".

## Q27 [Domain] Scope model is too coarse for least privilege
PAT scopes are `{namespace, repo?, maxRole}`, a cap on the owner's role. Read-only access to export data and "submit Jobs only" cannot be expressed, and scoped credentials are refused on several per-user routes. Scopes name repositories by name, so a rename changes what they mean. Scientists and CI owners will mint broad PATs because narrow ones are not possible.
**Example:** A dashboard tool needs to list commits in `oncology/trial-9`. The only option for that PAT is `read`, yet the same `read` scope also exports the full dataset.
**Options:**
- Action-category scopes (read, push, job.submit, lineage.read) on top of repo caps: real least privilege, bigger catalog.
- Keep role caps but bind scopes to repository ids: fixes rename, no new granularity.
- Leave as is: documented limitation.
**Recommendation:** Option 2 now (ids), Option 1 when service principals ship.
**Challenges:** Story 4 "scopes … least privilege"; "scoped PATs cap the owner's repo role".

## Q28 [Domain] Step-up and PATs raise the question of who may act "as" someone
Author injection stamps the Principal on commits made via PAT, so a CLI push by a script appears as the scientist personally, without a human decision. Part 11 e-signatures must not be delegable, but ordinary attributable records of automated actions are acceptable only if the system shows that a script acted. Today the audit has a `via` (session or PAT), but the commit itself does not.
**Example:** A cron script under Lena's PAT pushes data at 03:00. History shows "Lena Wagner" at 03:00; an auditor assumes she was at work.
**Options:**
- Mark PAT-originated writes in the commit trailer and audit (`via`: pat, plus token id): attributable, visible.
- Require automation to use service principals only; user PATs are read-only plus interactive: clean, restrictive.
- Leave as is: simple, misleading.
**Recommendation:** Options 1 and 2 phased, starting with trailers.
**Challenges:** "Author injection" and "automation owner PATs" conflating human and automated actors.

## Decisions log

| Q | Answer | Date |
| --- | --- | --- |
| Q1 | Directory-sync revocation + live IdP/directory check on PAT/credential use with short cache; if IdP unreachable keep last-known status for a bounded time and alert | 2026-10-25 |
| Q2 | Adopt back-channel logout (sessions-only) AND directory sync as supported; remove the 'out of scope' lines | 2026-10-25 |
| Q3 | DB time + monotonic revocation generation per Principal; 'immediate' = effective on all instances within 1 s of commit | 2026-10-25 |
| Q4 | Short-TTL cache (~2 s) stated as the guarantee; last-used writes throttled to once/min | 2026-10-25 |
| Q5 | Human CLI credential from `mice login` is short-lived (8-24 h, refreshable); no long-lived personal PATs (see Q14) | 2026-10-25 |
| Q6 | prompt=login + same iss+sub; require acr/amr (MFA) evidence where IdP exposes it | 2026-10-25 |
| Q7 | BFF callback receipt time is the freshness anchor; hard cap 5-15 min for signing | 2026-10-25 |
| Q8 | CLI step-up via device flow with fresh IdP login; web-only link as interim fallback | 2026-10-25 |
| Q9 | Always verify id_token signature, https issuer required, new ADR superseding 0001 (cross-cutting Q18) | 2026-10-25 |
| Q10 | iss+sub is immutable and is stored in oxen (via BFF-injected commit trailer) and in audit | 2026-10-25 |
| Q11 | Unsupported: changing IdP is not allowed | 2026-10-25 |
| Q12 | Superseded by Q-service-principals: service principals removed | 2026-10-25 |
| Q13 | Superseded by Q-service-principals: service principals removed | 2026-10-25 |
| Q14 | Short-lived credential from `mice login` + OS keychain; no service principals | 2026-10-25 |
| Q15 | Requester context on approval page, high-entropy code, 10-min expiry, polling limits, fresh login to approve, counters in Main database | 2026-10-25 |
| Q16 | SUPERSEDED by round 2 Q49/Q50 (server-side Sessions, key-ring) | 2026-10-25 |
| Q17 | Fetch groups server-side (directory lookup); fail login loudly on overage claims | 2026-10-25 |
| Q18 | Re-check groups against directory with stated max staleness; restricted repos need direct grants; no PATs involved | 2026-10-25 |
| Q19 | Idle 15 min, absolute 8 h; values in spec and tested; strict never allows 0 | 2026-10-25 |
| Q20 | Revoke terminates Desktop Sessions; running Jobs finish but their result commit is blocked | 2026-10-25 |
| Q21 | Keep absolute fail-closed (revoke/login get 503 if immudb is down); accepted risk, documented | 2026-10-25 |
| Q22 | No break-glass login; paper fallback + late-entry procedure with audited reason | 2026-10-25 |
| Q23 | Successful auth + admin/security events in immudb; failures to operational log with rate-limited summaries; no IP in immutable store | 2026-10-25 |
| Q24 | Shared DB-backed limits on token/device-code/mint endpoints, per-IP and per-Principal, fail closed, alert on spikes | 2026-10-25 |
| Q25 | Atomic first-admin creation (unique constraint), bootstrap matched on iss+sub, audited recovery when no admin remains | 2026-10-25 |
| Q26 | New project: no migration; confirm no live PATs/cookies/cut-offs exist | 2026-10-25 |
| Q27 | Scopes reference stable repository ids; add action-level scopes (read-metadata, read-data, submit-job) | 2026-10-25 |
| Q28 | Audit-only `via` (as today); no commit trailer for automation | 2026-10-25 |

**Cross-module consequence (owner decision):** service principals are removed; Jobs use BFF-internal job tokens and CI is unsupported. Update specs 01, 02, 09, 12-14 and cross-cutting Q19 accordingly. Conflict to review: Q10 says oxen holds iss+sub (needs a commit trailer); Q28 chose no trailer for automation.
