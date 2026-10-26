Status: ready-for-agent

# 01 — Authentication (PLAT-AUTH)

## Problem Statement

Users and CLI tools need to prove who they are to Mice, and every request must carry an attributable Principal. Credentials must be revocable within seconds, whether triggered by an admin or by directory sync.

## Solution

SSO login through an external IdP yields a sealed Session cookie; the CLI uses a short-lived credential from a device-flow login, kept in the OS keychain. There are no PATs and no service principals; Jobs use BFF-internal tokens. The BFF authenticates every request, keys the Principal by IdP `iss`+`sub`, and injects commit author identity. Admins can revoke all Sessions and credentials of a Principal at once.

## User Stories

1. As a scientist, I want to sign in with my organisation's SSO, so that I do not manage another password.
2. As a scientist, I want my session to expire after inactivity, so that an unattended browser is not a risk.
3. As a CLI user, I want to log in through a device flow, so that I get a short-lived credential without pasting secrets.
4. As a CLI user, I want my credential scoped to repository ids and actions and refreshable for 8-24 hours, so that no long-lived secret exists.
5. As a user, I want to see and revoke my own CLI credentials, so that I can respond to leaks.
6. As an instance admin, I want to revoke all Sessions and credentials of a Principal by `iss`+`sub`, so that offboarding takes effect within seconds.
7. As an instance admin, I want a UI action for that revoke, so that I do not need the API.
8. As an auditor, I want every login, logout, failure, mint and revoke audited, so that identity events are attributable.
9. As a compliance lead, I want step-up re-authentication for sensitive actions, so that fresh proof of identity is available to downstream workflows (e.g., GxP signatures).
10. As a repository collaborator, I want my commits authored with my IdP name and email, so that history is attributable (author injection).
11. As an instance admin, I want revocation to terminate the Principal's Desktop Sessions and block result commits of running Jobs, so that offboarding is complete.
12. As an instance admin, I want directory-sync revocation and back-channel logout, so that offboarding does not depend on a manual step.
13. As an operator, I want production to refuse to start with dev defaults, so that weak auth never ships.
14. As a user with a changed `sub` or a different IdP, I want to be treated as a distinct Principal, so that identities are never merged silently.

## Implementation Decisions

- Principal identity is `iss`+`sub` (ADR 0001); no cross-IdP merging.
- Sessions are sealed cookies, idle timeout 15 minutes and absolute 8 hours; strict never allows 0.
- CLI credentials are short-lived and scoped to stable repository ids and action-level scopes, intersected with live permissions. There are no PATs and no service principals.
- Revocation uses a database-time cut-off plus a monotonic revocation generation per Principal; it is effective on all instances within 1 s of commit, with a short-TTL cache (about 2 s) as the stated guarantee.
- Groups are fetched server-side from the directory and re-checked with a stated maximum staleness; overage claims fail login loudly.
- Offboarding combines directory-sync revocation, a live IdP/directory check with a short cache, back-channel logout (Sessions only) and manual admin revoke. If the IdP is unreachable, last-known status is kept for a bounded time and an alert is raised.
- Step-up: fresh IdP login (prompt=login, same `iss`+`sub`, MFA evidence where exposed), anchored on BFF callback receipt time with a 5-15 minute hard cap; the CLI uses a device flow.
- The id_token signature is always verified and an https issuer is required.
- Production requires an external IdP; Keycloak is development-only.
- All state in PostgreSQL; multiple BFF instances share revocation state.

## Testing Decisions

- Test through the BFF HTTP boundary: login callback, cookie behaviour, CLI credential use, revoke, step-up.
- Revocation is tested across two BFF instances.
- Prior art: existing auth API tests and the Playwright login flow.

## Out of Scope

SCIM provisioning, SAML beyond IdP brokering, IdP change for existing Principals, key-rotation tooling.

## Further Notes

Stale IdP group membership is bounded by the stated maximum staleness of the directory re-check.

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Credentials and offboarding
- Directory-sync revocation plus a live IdP/directory check with a short cache; if the IdP is unreachable, keep last-known status for a bounded time and alert (Q1).
- Back-channel logout (Sessions only) and directory sync are supported; the old out-of-scope lines are removed (Q2).
- Revocation uses database time and a monotonic generation per Principal; effective on all instances within 1 s of commit (Q3). A short-TTL cache (about 2 s) is the stated guarantee, and last-used writes are throttled to once a minute (Q4).
- The human CLI credential from `mice login` is short-lived (8-24 h, refreshable), kept in the OS keychain; no long-lived personal tokens (Q5, Q14).
- Service principals are removed; Jobs use BFF-internal tokens and CI is unsupported (Q12, Q13, Q14).
- Credential scopes use stable repository ids and add action-level scopes: read-metadata, read-data, submit-job (Q27).
- Revoke terminates Desktop Sessions; running Jobs finish but their result commit is blocked (Q20).

Step-up and tokens
- Step-up uses prompt=login with the same `iss`+`sub`, and requires acr/amr (MFA) evidence where the IdP exposes it (Q6).
- BFF callback receipt time is the freshness anchor, with a hard cap of 5-15 minutes for signing (Q7).
- CLI step-up is a device flow with a fresh IdP login; a web-only link is an interim fallback (Q8).
- The device flow shows requester context, uses a high-entropy code, 10-minute expiry, polling limits, a fresh login to approve, and counters in the Main database (Q15).
- The id_token signature is always verified, https issuer required, and a new ADR supersedes ADR 0001 (Q9).
- No key-rotation tooling; a leaked secret means logging everyone out, accepted (Q16).

Identity and groups
- `iss`+`sub` is immutable and is stored in oxen through the BFF-injected commit trailer for humans, and in audit (Q10).
- Changing IdP is unsupported (Q11).
- Groups are fetched server-side; overage claims fail login loudly (Q17). Groups are re-checked against the directory with a stated maximum staleness; restricted repositories need direct grants (Q18).
- Session idle timeout is 15 minutes and absolute 8 hours, tested; strict never allows 0 (Q19).

Audit, limits and bootstrap
- Absolute fail-closed: revoke and login return 503 if immudb is down; accepted risk (Q21). No break-glass login; a paper fallback with late-entry procedure and audited reason applies (Q22).
- Successful authentication and admin/security events go to immudb; failures go to the operational log with rate-limited summaries; no IP in the immutable store (Q23).
- Shared database-backed limits on token, device-code and mint endpoints, per-IP and per-Principal, fail closed, alert on spikes (Q24).
- First-admin creation is atomic via a unique constraint, matched on `iss`+`sub`; audited recovery when no admin remains (Q25).
- New project: no migration; confirm that no live credentials, cookies or cut-offs exist (Q26).
- Automation is audit-only via `via`; no automation commit trailer (Q28).

## Conflicts and open risks

- Q10 versus Q28: oxen holds `iss`+`sub` through a commit trailer for humans only; automation has no trailer, so Job commits are attributed through audit `via` alone. Resolved by the global decision; the 09 and 08 specs must state it.
- Q4 (short-TTL cache of about 2 s) versus 15 Q18 and Q21 (no cache, per-request revocation read): CONFLICT on the cache; reconcile in implementation, the stricter reading is no cache.
- Q18 (staleness bound) versus 15 Q21 (no cache) and 02 Q12 (max staleness): the same staleness figure must be shared across 01, 02 and 15; open.
- Q1: a live check on credential use is kept only for the short-lived CLI credential, since PATs do not exist; the IdP-unreachable bounded grace is a RISK that revoked users stay active during an outage.
- Q21: absolute fail-closed means no logins or revokes while immudb is down; accepted RISK, and 15 Q7 notes the incident-response gap (break-glass declined).
- Q16: a secret leak logs everyone out; accepted RISK, no rotation tooling.
- Q6 and 04 Q4: if the IdP exposes no acr/amr, step-up is refused for signing; the IdP must be validated.
- Q26: PENDING confirmation that no live credentials, cookies or cut-offs exist.
- Q20: running Jobs finish but their commit is blocked; their held output follows 04 Q12 and 08 Q11.
- Q12, Q13 and 00 Q19 are superseded by service-principal removal; stories 11-12 of 02 and 12-14 specs still reference them.

## Round 2 decisions (Q29–Q68, see questions-round2.md)

- Identity: person-account claim required (Q30); IdP change stays unsupported (Q29); canonical iss + internal id + unique key (Q63); name snapshot and history (Q40); pseudonymised identifiers with erasable mapping, legal to confirm (Q48); auto-provision of all IdP users (Q31); automatic restore on IdP re-enable (Q32).
- Sessions: server-side Session rows with opaque cookie (Q49); single Session per Principal (Q38); logout revokes everything (Q34); fresh authentication per signature (Q36); cookie hardening and start gate (Q51); key-ring rotation (Q50); single-use Postgres login state (Q52); server-side return target (Q53).
- Credentials: rotating refresh with reuse detection, 30-day cap (Q56); keychain keyed by Principal with acting-as banner (Q35); device binding planned (Q57); RFC 8628 hardening (Q58).
- Revocation and groups: 2 s cache with NOTIFY (Q59); conditional last-used updates (Q60); group-id matching (Q62); login blocked if directory down (Q61); ACCESS_REVOKED code (Q39); Job token checks submitter at commit (Q37); suspend capability and self-suspend (Q42).
- Signing assurance: refuse without MFA evidence (Q43); signing declaration (Q44); IdP baseline check (Q45); no impersonation (Q46).
- Protocol: JWKS fetched on every request (Q54); 5 min leeway (Q55); full back-channel logout validation (Q65); uniform errors (Q66); trailer strip-and-append (Q64); two-person recovery token (Q67); security log with retention (Q41); test IdP suite (Q68).
- Inspectors: escort-only, no accounts (Q33).

### New conflicts and risks
- RESOLVED: single IdP only; externals and Auditors use it (Q29, Q33, Q47).
- Q29 contradicts 13 Q11, 14 Q22, 15 Q16 which plan IdP migration.
- Q31 open (see round 3). Q32 confirmed: IdP re-enable restores access without review.
- Q38 single-session conflicts with CLI + web + Desktop use and Q35 shared PCs.
- Q54 JWKS per request creates an availability and latency dependency on the IdP; Q55 weakens replay protection (recommended 60 s).
- Q54/Q61 confirmed: IdP/directory always checked; outage = no login.

## Round 3 decisions (inconsistency review)

Owner answers; supersede earlier rounds where they conflict.

- Q69: bootstrap rules (15 Q9/Q10) apply to everyone including externals. RISK: a guest in a matching IdP group gets rule-granted rights at first login; keep guest accounts out of privileged groups in the IdP.
- Q70: multiple concurrent sessions per Principal are allowed (reverses Q38). OPEN: cap per Principal and a "my sessions" list were not chosen; default proposal is cap 5 with list and revoke-one.
- Q71: the IdP/directory is checked at login, refresh, step-up/signing, each privileged mutation, and for ordinary requests at most every 5 min. If the check cannot run within the bound, deny.
- Q72: IdP status is live; Mice flags (admin/security-role/bulk revoke) are separate and need an explicit lift. IdP re-enable restores access only if no Mice flag is set. Grants are kept (suspended), not deleted.
- Q73: CLI access token 8 h; refresh rotates in a 30-day family cap and re-checks the IdP each refresh; web Session absolute 8 h.
- Q74: logout ends web and CLI credentials; Desktop Sessions are suspended and resume after login within their lifetime.
- Q75: fresh authentication per signing action; bulk approval is one ceremony with every item in the signed manifest; leeway 60 s for signing (Q55's 5 min applies elsewhere); step-up window never reused.
- Q76: iss+sub appear in audit and commit trailers as a keyed HMAC pseudonym; the lookup table in Postgres is erasable. History is not rewritten. Legal to confirm.
- Q77: security-role suspend is the one emergency exception to Intent-first: durable Postgres queue marked deferred append, effective at once, appended to immudb on recovery. Needs an ADR (like lease renewals).
- Q78: Auditor Principals have an admin-set expiry enforced in Mice, MFA evidence required (Q43), every read audited, no writes.
- Q79: no revocation cache; one read per request (15 Q21 wins; Q4/Q59 2 s cache dropped).
- Q80: IdP-migration tooling in 13 Q11, 14 Q22, 15 Q16 is moot and removed.
- Q81: source IPs live only in the ~90 d security log and the operational log; audit events carry request id and hashed pointer; 16 Q19 applies to the security log.
- Q82: shared OS accounts are forbidden (one OS user = one Principal on a CLI host); Q35 keychain-per-Principal remains a safeguard.
- Q83: commit-time submitter check calls the IdP; if down, the commit is held in finalizing (09) until it returns or retention ends; never auto-approved.

Status: needs-info on Q70 details (cap, listing) and legal confirmation of Q48/Q76.

## Round 4 decisions (regulatory consistency check)

Basis: 21 CFR Part 11, EU Annex 11, ALCOA+. Supersedes earlier rounds on conflict.

- R1: auto-provision gives zero rights. Bootstrap rules (Q69) may grant read-only baseline only; write, sign and approve always need a recorded admin grant. IdP re-enable restores access automatically if disabled 30 days or less; longer needs admin re-confirmation. Every restore is audited. (Refines Q31, Q32, Q69.)
- R2: NO identity data is erasable. Mapping is retained for the full retention period (reverses Q48 and Q76 pseudonymised/erasable mapping). Raw iss+sub in audit and trailers is acceptable. Legal basis (GDPR Art. 17(3)) must be documented. Consequence: 13 Q24 "keep and ignore" and all erasure items are consistent; the pseudonym/HMAC design is dropped.
- R3: all security events including source IPs go to immudb with full retention (reverses Q41 90-day log and Q81). RISK: IPs are personal data under GDPR; minimisation and documented legal basis needed; 16 Q19 applies to audit.
- R4: bulk approval is one authentication ceremony with one signature record per item (own name, time, meaning, record hash, shared ceremony id); cap 50 items (replaces the single signed manifest in Q75).
- R5: regulated timestamps come only from the BFF server clock (NTP-synced, alert on drift above 1 s); client time never used as event time; leeway applies only to token validity.
- R6: IdP is a qualified supplier: documented assessment, change-notification agreement, Q45 baseline check at each deploy and daily, signing refuses without MFA evidence; results in the validation pack.
- R7: no electronic fallback for IdP outage. A documented paper/manual procedure with later transcription is in the validation pack; each outage is an incident; no emergency local accounts.
- R8: NO deferred audit append: suspend fails with 503 when immudb is down (reverses Q77; consistent with 15 Q7 and 15 Q21). The suspend-exception ADR is not needed; the lease-renewal exception stays pending.
- R9: no cap on concurrent sessions (Q70 answered). RISKS: Part 11 11.300 is satisfied only because shared credentials are forbidden (Q82); unlimited sessions enlarge the stolen-cookie surface. Idle timeout was not answered: OPEN, recommended 30 min for web with no signing from an idle session.

Status: needs-info on R9 idle timeout, legal confirmation of R2/R3 retention basis, lease-renewal exception.

## Round 5 decisions (owner clarifications)

- IPs: not stored anywhere (neither audit, security log nor operational log fields). Reverses R3 IP part, Q23 and Q81. Events carry request id and Principal only. 16 Q19 "record both addresses" is dropped. Open: how abuse and unauthorised-use detection (Part 11 11.300(d)) work without IPs.
- Precedence: GxP requirements beat GDPR whenever they conflict (reaffirms R2).
- R9 idle timeout: accepted: 30 min for web, no signing from an idle session.
- Shared credentials are strictly forbidden (Q82, 11.300); not merely a safeguard.
- Lease renewal: owner does not know it; exception stays PENDING, explained plainly in the next batch.

## Round 6 decisions (regulatory gaps)

- S1: lease renewal. Owner asked whether it is the RW workspace mount: a lease is the exclusive write lock on that mounted Workspace (08). No owner choice; spec adopts the strict default (every renewal has its own Intent/Outcome; immudb down means work stops at lease expiry), consistent with "GxP strict always on". The lease-renewal exception ADR draft is withdrawn; 00 Q3, 08 Q18 and 08/00 "pending" notes need updating. Owner may overrule.
- S2: IdP enforces lockout and password policy (recorded in the Q45 baseline). Mice audits every failed or refused authentication against a known Principal (no IP) and alerts security admins after 5 failures in 10 min.
- S3: quarterly access review report (Principals, roles, grants, last login), signed electronically by a named reviewer; unreviewed after 14 days alerts.
- S4: training and qualification are out of this spec; a separate training spec will be written and will impact authorization (sign/approve grants). Authorization must expose a hook for qualification-gated grants.
- S5: hard segregation of duties: nobody approves or signs off their own submission or Job; enforced in the BFF per record; refusals audited; no admin override.
- S6: each signature record stores IdP authentication evidence (auth time, method and strength claims, IdP session id, token id) with meaning, time and record hash.
- S7: any change to a Principal's roles or grants ends their Sessions and CLI credentials; fresh login required.
- S8: iss+sub is never reused and is permanently bound to one person record; reissue to another person refuses login and raises an incident; rehire gets the same Principal if the sub matches, else a new Principal linked by an admin-signed note.
- S9: admins cannot edit or delete audit, signature or Principal-history records by any route; support access is read-only and audited; DB superuser access is break-glass outside Mice under an SOP.

## Round 7 decisions (regulatory gaps)

- T1: one table in the spec lists Session, CLI credential and Job lifetimes. Job token lifetime equals the Job's maximum runtime and is re-checked against the IdP at commit; refresh family cap 30 days; no credential outlives the Principal's IdP status.
- T2: automated actions are attributed to the submitting Principal plus a "performed by Job <id>" marker; Jobs never sign; only humans sign.
- T3: NO support access at all. Amends S9: the "read-only audited support access" clause is removed. Only Auditors (Q33/Q78) have cross-user read access.
- T4: signing shows the exact record with its hash bound in the same ceremony; a record changed after display invalidates the signature; UI shows meaning (Authored / Reviewed / Approved) and the signer's full name.
- T5: daily automated drift report of IdP baseline vs Mice access state; alarm when a Principal holds sign rights while disabled in the IdP; stored as validation evidence.
- T6: authentication ships a CSV pack: requirements traced to tests (Q68), risk assessment, IQ/OQ evidence, revalidation on any IdP-baseline or auth-code change.
- T7: all authentication events (login, refresh, logout, step-up, failure, revocation) audited with request id and Principal; tokens, cookies and codes never logged; redaction is a tested rule.
- T8: signature shows the name as of signing (Q40 snapshots); the name comes from the IdP; login is refused if the name claim is empty.

## Consolidated final position (supersession map)

Effective rules where answers conflicted: Q4/Q59 cache dropped (Q79); Q16 superseded; Q38 reversed by Q70/R9 (no cap, 30 min idle, no signing from idle); Q41/Q81/R3 IPs: none stored; Q48/Q76 pseudonym dropped (R2); Q77 dropped (R8); Q75 manifest replaced by per-item records (R4); Q69 limited to read-only baseline (R1); S9 amended by T3.

Remaining open items: (1) legal confirmation of R2 no-erasure and GxP-over-GDPR precedence; (2) abuse detection without IPs relies on S2 only, to be confirmed acceptable to QA; (3) propagate to 00, 08, 13, 14, 15, 16 specs and ADR drafts (lease exception draft withdrawn, IdP-migration items moot, IP items dropped); (4) separate training spec (S4); (5) **Auditor mode (Q33/Q78/T3) utility functions implemented but not integrated**: no database schema, no session user flag, no route exposure, no middleware enforcement - requires ~6-7 hours to complete integration (admin routes, SessionUser extension, read-only middleware, audit logging, UI).

---

# Open Questions


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


## Questions Round 2


Status: new questions. They assume earlier decisions in `questions.md` may be wrong and test those decisions against other modules. 20 Domain (Q29–Q48), 20 Impl (Q49–Q68).
Biggest suspect decisions: Q11 (IdP change unsupported) vs 15 Q11/13 Q11/14 Q22 (IdP migration); Q16 (no key rotation) vs 16 Q13 (key-ring); Q23 (no IP in immutable store) vs 16 Q19 (record forwarded address); Q10 (trailer) vs Q28; Q21 (revoke blocked when immudb is down) vs incident response; Q19 (8 h absolute) vs long Jobs and Desktop Sessions.

## Domain questions

## Q29 [Domain] "IdP change is unsupported" collides with three other modules that plan an IdP migration
Q11 says changing the IdP is not allowed, yet 13 Q11 (favorites rebind tool), 14 Q22 (subscriber cleanup after IdP migration) and 15 Q16 (adapter per chosen IdP) all assume it can happen. Mergers, vendor price changes and security incidents force IdP changes within a 10-year retention horizon. Identity is keyed by iss+sub, so a change orphans every grant, signature and favorite.
Example: In 2028 the company is acquired and must move from Okta to Entra. 900 Principals get new `sub` values; 14,000 grants, 3,100 e-signatures (named by iss+sub) and 30,000 favorites point to dead identities. An auditor must still trace a 2026 signature to a living person.
Options:
- Support an audited, QA-approved "identity re-binding" (old iss+sub → new iss+sub) as a first-class admin operation, recorded in immudb, never rewriting history — complete, real work.
- Keep unsupported and accept a full re-onboarding with data left under orphaned identities — simple, painful.
- Allow multiple linked identities per Principal from day one — flexible, new concept and account-takeover surface.
Recommendation: Re-binding as a documented, dual-approved, audited operation; history keeps the original iss+sub and shows the link. Reverse Q11.
Challenges: Q11 "Unsupported"; 13 Q11; 14 Q22.

## Q30 [Domain] Who is the "person" behind a Principal for GxP: is a shared or role mailbox account ever acceptable?
Part 11 requires unique individual accounts. The IdP may contain shared accounts ("lab-bench-3", "qa-team") that can log in and receive grants. The BFF cannot tell a person from a shared account unless the IdP exposes it.
Example: Technician accounts share the IdP login "microscope-room" to speed up work. A file is uploaded and an approval is signed by it; the auditor asks "who?" and nobody can say.
Options:
- Require an IdP claim marking a human individual account; refuse login otherwise — enforceable if the IdP can supply it.
- An admin-maintained deny-list of shared accounts — manual, always behind.
- Document as an IdP-side control only — cheap, unverifiable by the platform.
Recommendation: Require a person-account claim or an allowed-account-type attribute, and record the claim value in the signature.
Challenges: Cross-cutting "unique individual identity" assumption.

## Q31 [Domain] What proof of identity does a first login need before it receives anything?
First login creates a Principal automatically from IdP claims, and bootstrap rules then add grants by group. If the IdP is lax (self-service signup, federated guest accounts), a stranger becomes a Principal with default access.
Example: The IdP accepts B2B guest invitations. A contractor from a partner firm accepts an invite, logs in, matches a bootstrap rule "domain=*.example.com" through a mail alias, and becomes a Namespace member.
Options:
- Auto-create Principals but with zero grants until an admin approves — safe, adds a manual step.
- Allow an allow-list of IdP groups to auto-provision; everyone else is pending — scalable.
- Auto-provision everything the IdP asserts — fast, trust fully delegated.
Recommendation: Allow-list of IdP groups for auto-provisioning; all others pending with admin notification.
Challenges: 15 Q9 (rule-derived grants) assume group membership is trusted.

## Q32 [Domain] How does an account that was disabled and re-enabled in the IdP come back?
Offboarding and rehire, leave of absence and "temporary lock" all toggle the IdP account. The platform revokes Principals permanently (revocation generation increments), but a re-enabled person is the same iss+sub.
Example: Maria is on parental leave for 8 months; her account is disabled and the BFF revokes her Principal. On return, the IdP re-enables her; login succeeds, but is she re-granted her 40 repositories and 12 pending signatures?
Options:
- Revocation is permanent; re-activation is an explicit admin operation that re-issues only grants that are re-approved — controlled, slower.
- Revocation is lifted automatically when the IdP re-enables, grants return — convenient, silently restores old access.
- Revocation persists but grants return after the data owner's confirmation — middle ground.
Recommendation: Re-activation requires an admin action; grants return only for namespaces whose owner confirms; audited.
Challenges: 15 Q8, Q9 (bulk revoke, rule-derived grants).

## Q33 [Domain] Is a read-only Auditor/Inspector login the same authentication class as a scientist?
02 introduces an Auditor role and elevated admin step-up. Inspectors are external, often time-boxed, and may use a different IdP tenant or guest accounts.
Example: A regulatory inspector arrives for a 3-day on-site visit. The company creates a guest account in the IdP; the inspector has no MFA enrolled and the visit needs read access to audit evidence for 72 hours only.
Options:
- Time-boxed guest Principals with mandatory step-up on every sign-in and an automatic expiry date — fits inspections.
- Escort-only: the inspector uses a company employee's screen; no accounts — simple, no direct attribution.
- Treat like any other user — no inspection-specific controls.
Recommendation: Time-boxed Auditor Principals with forced MFA evidence and automatic expiry; every access audited.
Challenges: 02 Auditor role; Q19 session lifetimes.

## Q34 [Domain] What does "logout" mean when the user also holds a CLI credential and a Desktop Session?
Back-channel logout (Q2) ends web sessions. A user who clicks "log out" on a shared workstation still has a keychain-stored CLI credential and a running Desktop Session.
Example: Dr. Lee logs out of the web at a shared instrument PC. His `mice` CLI token in the OS keychain is valid for 22 more hours; the next scientist who uses that account on the PC can run `mice push`.
Options:
- Logout revokes all of that Principal's CLI credentials issued from that device/session family — secure, may log out other devices.
- Logout ends the web Session only; CLI credentials have their own lifecycle — as is.
- Offer both: "log out here" vs "log out everywhere" — user choice, more UI.
Recommendation: "Log out" revokes credentials tied to that browser session's family; "log out everywhere" revokes all.
Challenges: Q5, Q14, Q20.

## Q35 [Domain] Shared lab workstations and instrument PCs: whose identity does the CLI use?
Many labs run data acquisition on shared Windows PCs with one OS account. The OS keychain is per OS user, not per person.
Example: Instrument PC "FACS-02" has one OS user "labuser". Two scientists run `mice login`; the second overwrites the first's keychain entry and the first's upload resumes under the second person's identity.
Options:
- Credential store is keyed by Principal and requires explicit `mice login` per person with visible "logged in as" on every command — transparent.
- Forbid CLI on shared OS accounts and require per-person OS accounts — policy only.
- Per-command re-authentication (device flow) for write commands on shared hosts — heavy but unambiguous.
Recommendation: Keychain entries keyed by Principal plus a mandatory "acting as" banner and write-command confirmation when a second Principal is detected.
Challenges: Q14, 07 CLI.

## Q36 [Domain] How long may an unattended browser stay signed in at a shared screen?
Idle 15 min and absolute 8 h (Q19) assume a person is present. Operators watch dashboards, review queues and long approvals while the screen is unattended in an open lab.
Example: A QA reviewer leaves a laptop open with the approval page after a signature step-up; a colleague approves the next request while the 5-minute step-up window is still valid.
Options:
- Step-up window ends immediately when the page is idle or tab hidden, with re-prompt before every signing action — safest.
- Fixed 5-minute step-up window regardless — simple, shoulder-surf window.
- Re-authenticate per signature always — maximum control, friction.
Recommendation: Per-signature fresh authentication in the always-strict world, which matches Part 11 sign-off semantics.
Challenges: Q6, Q7, 04 e-signatures.

## Q37 [Domain] Is an 8-hour absolute lifetime compatible with long Jobs, uploads and Desktop Sessions?
Q19 fixes 8 h absolute. Q20 says running Jobs finish after revoke. An overnight Job, a 30 GB upload resumed next morning, or a multi-day Desktop Session all outlive the Session that started them.
Example: A scientist starts a 14-hour simulation at 17:00. The Session expires at 01:00. At 07:00 the Job finishes and tries to commit the result; whose authority applies?
Options:
- A Job runs on a job token bound to the submitter's permissions at submission and re-validated at commit — consistent with 09.
- Require the Session still be valid at commit — blocks overnight work.
- Extend the Session while a Job runs — weakens the lifetime guarantee.
Recommendation: Job token plus a "submitter still active" check at commit (not session validity); document in 09 and here.
Challenges: Q19, Q20, 09.

## Q38 [Domain] May the same person hold two simultaneous interactive Sessions?
Nothing says whether concurrent logins are allowed. Part 11 reviewers often care about "who was logged in where".
Example: User A is logged in on a desktop in the lab and on a laptop at home. A suspicious download happens at 02:14 from the laptop; the audit shows a Session id but the user says it was not them.
Options:
- Allow N Sessions (for example 3), list them in a profile page, show device/location, allow kill — usable, transparent.
- Single session per Principal (new login kills the old) — simple, annoying for CLI + web.
- Unlimited, no listing — nothing to defend.
Recommendation: Allow up to a capped number, with a "my sessions" view and server-side revocation by Session id (needs Q16 revisit).
Challenges: Q16 (sealed cookies cannot be listed).

## Q39 [Domain] What does a user see when authorization is revoked mid-action?
A user who loses access during a multi-step workflow (upload, merge, signature) experiences an opaque 401/403 and may lose work.
Example: A scientist uploads 18 GB for 40 minutes; at minute 38 an admin revokes her. The upload fails at chunk 3,700 with "403" and nothing explains that her account was disabled.
Options:
- A distinct error code "ACCESS_REVOKED" with a safe message and support contact; partial uploads parked and discarded per policy — clear.
- Generic 401 — nothing leaked, confusing.
- Allow the in-flight upload to finish to a quarantine area — preserves work, complexity.
Recommendation: Distinct code, no resource details, partial data discarded by default.
Challenges: Q3, Q20, 06 transfer.

## Q40 [Domain] How are minors of identity handled: display name, email changes and name collisions?
Names and e-mails change (marriage, legal name changes, typos). Q10 pins iss+sub, but signatures show the name text.
Example: "Anna Berger" signs 200 approvals, then legally becomes "Anna Hoffmann". An auditor sees both names for the same sub and cannot tell if it is two people.
Options:
- Store the name at signing time and keep a per-Principal name history table with effective dates — clear lineage.
- Always render the current IdP name — rewrites history visually.
- Show iss+sub only — unambiguous, unreadable.
Recommendation: Name snapshot at signing plus a name-history view and a visible "same person" link.
Challenges: 04 name snapshot decision, Q10.

## Q41 [Domain] What is the privacy boundary of authentication data (IP, device, location)?
Q23 keeps IPs out of the immutable store. 16 Q19 records the socket address and forwarded value. Security investigations need source information, privacy law limits it.
Example: A credential is used from a foreign IP at 03:00; the investigators can't tell because IPs live only in an operational log rotated after 14 days.
Options:
- Keep IPs in a separate access-controlled, time-limited security store (e.g. 90 days) — balances both.
- Store in immudb hashed with a key — equality only, no geolocation.
- Never store IPs — maximum privacy, weak forensics.
Recommendation: Separate security log with defined retention and restricted read access; hashed pointer in immudb.
Challenges: Q23 versus 16 Q19.

## Q42 [Domain] What is the escalation path for a suspected compromised account?
Revoke exists, but nobody has defined who decides, how fast, and what evidence is preserved.
Example: A user reports a phishing click at 16:40 on Friday. The only admin with step-up is on a flight; revoke is blocked until Monday.
Options:
- Define a security-incident procedure: any QA/security officer can suspend a Principal (not delete), suspension is audited, and a second admin confirms within 24 h — fast and accountable.
- Only instance admins can revoke — as is.
- Let users self-suspend via a "panic" action — fast, abuse risk.
Recommendation: Add a "suspend" capability for a security role plus self-suspend with audit.
Challenges: Q21 (revoke blocked on immudb outage), 15 Q7 (break-glass declined).

## Q43 [Domain] Do we trust the IdP's MFA claim, and what if there is none?
Q6 requires acr/amr "where the IdP exposes it". Some IdPs never expose it, others allow downgrade of the MFA policy for a group.
Example: A conditional-access policy exempts the "lab" network from MFA. Step-up succeeds with a password only, yet the BFF records a valid e-signature.
Options:
- Refuse signing when acr/amr evidence is missing — strict, may block customers.
- Accept with an explicit "MFA not evidenced" flag stored in the signature — transparent, weaker.
- Maintain per-IdP profile of what the claims mean, validated during IQ — formal.
Recommendation: Refuse signing without evidence (strict always on); IdP profile validated at qualification.
Challenges: Q6, 04 IdP must assert acr/amr/auth_time.

## Q44 [Domain] Is "first successful login" a legal act of accepting responsibility?
GxP systems commonly require users to accept an electronic-signature declaration (equivalent to handwritten) before first use.
Example: A reviewer signs 50 merges before any record shows she acknowledged that her e-signature has legal binding.
Options:
- Mandatory one-time declaration screen stored in immudb with text version and digest — Part 11 standard.
- Out-of-band paper/LMS acknowledgement referenced by id — works with customer process.
- None — risk of inspection finding.
Recommendation: In-app declaration with versioned text before any signing capability is active.
Challenges: 04; training gate out of scope.

## Q45 [Domain] Who owns the IdP relationship and its configuration changes?
The platform's identity assurance depends on IdP settings (MFA, session lifetime, claim mapping). Changes there change the platform's validated state with no trace.
Example: The IT team removes the `amr` claim from tokens on a Tuesday. Signing silently stops evidencing MFA until someone notices.
Options:
- A configuration-baseline check at startup and periodically (expected claims, discovery document hash), alert on drift — detective.
- Contract: change control between IT and QA, no technical check — process-only.
- Pin IdP metadata and require explicit admin acceptance of changes — strict.
Recommendation: Periodic baseline check with alert plus a documented joint change process.
Challenges: Cross-cutting supplier/change control.

## Q46 [Domain] Is impersonation or "support access as the user" ever allowed?
Support teams routinely ask for impersonation to reproduce problems. In a GxP product this breaks attribution.
Example: Support needs to see why Priya's job list is empty. A developer asks for "view as" and an admin implements it; actions taken during the view are attributed to Priya.
Options:
- Never: provide an admin diagnostic view ("effective permissions" from 15 Q25) and redacted trace — safe.
- Read-only impersonation with a banner, reason and audit — helpful, risk.
- Full impersonation — unacceptable.
Recommendation: Never impersonate; use effective-permissions trace and audited diagnostics.
Challenges: Q28 ("who may act as someone").

## Q47 [Domain] How are external collaborators (CRO, partner sites) authenticated?
Many studies involve other organisations. Federation with their IdP or guest accounts in the home IdP are the two usual routes, each with different assurance levels.
Example: A CRO analyst needs read access to one repository for 6 months. The customer's IdP supports B2B guests with no MFA enforcement.
Options:
- Guests only via the home IdP with enforced MFA and an expiry date; grants limited to named repositories — manageable.
- Federated second IdP — complex, conflicts with Q11.
- Disallow external users — simple, blocks collaboration.
Recommendation: Home-IdP guests with enforced MFA and expiry; document as the only supported external path.
Challenges: Q11 single-IdP assumption; 02 expiry.

## Q48 [Domain] What is the decommissioning story for authentication data when the platform is retired?
Retain forever means identity records live as long as the audit trail. People's personal data then has no deletion horizon.
Example: A defunct employee asks 8 years later which authentication events are stored about them and requests deletion.
Options:
- Pseudonymise in the platform: keep a keyed hash of iss+sub in immudb and keep the name-to-id mapping in Postgres, erasable under legal process — compliance-friendly.
- Store everything in the clear forever — simple, conflicts with privacy law.
- Declare legal basis "regulatory retention" and refuse erasure — needs legal sign-off.
Recommendation: Pseudonymised identifiers in the trail, mapping table erasable; legal confirms.
Challenges: 00 Q8 (no-erasure stance); 12 Q12.

## Implementation questions

## Q49 [Impl] Session representation: why sealed cookies at all if revocation needs a DB read every request?
Q16 accepted sealed cookies with "no key rotation tooling" while Q4 reads the DB on each request for revocation. A server-side Session table would support listing, kill-by-id and rotation at the cost of the very read already made.
Example: An admin wants to kill one of Dr. Cho's three sessions. With sealed cookies the only option is to bump her revocation generation, killing all.
Options:
- Server-side Session rows (opaque random id in the cookie) in Postgres with expiry — listable, killable, rotatable.
- Keep sealed cookies plus a generation counter — stateless-ish, coarse.
- Hybrid: sealed cookie carrying a session id checked against the table — both.
Recommendation: Server-side Session table; cookie holds only an opaque id.
Challenges: Q16, Q38, 16 Q13.

## Q50 [Impl] Cookie key rotation contradicts the operations decision on key-rings
Q16: "no rotation tooling; leak ⇒ everyone logged out". 16 Q13 chose a key-ring with current and previous keys for at least the session key.
Example: A security audit mandates annual secret rotation. With no tooling, each rotation logs out 900 users mid-shift.
Options:
- Adopt the key-ring (current + previous) with a rotation schedule and an emergency cut-over — consistent.
- Keep as is — contradicts 16.
- Server-side sessions remove the key dependence altogether — see Q49.
Recommendation: Reverse Q16 to key-ring (or drop sealing via Q49).
Challenges: Q16 vs 16 Q13.

## Q51 [Impl] Cookie attributes, CSRF and SameSite behind a Kubernetes ingress
Cookie flags depend on the proxy chain. The earlier decisions say nothing about SameSite, Secure, host prefix, or origin checks for state-changing requests.
Example: The ingress terminates TLS; the BFF sees HTTP and, trusting the wrong header, sets cookies without `Secure` in one environment.
Options:
- `__Host-` prefix, Secure, HttpOnly, SameSite=Lax, plus Origin/Fetch-metadata checks and a custom header for mutation requests — defense in depth.
- SameSite=Strict only — breaks IdP redirect returns.
- Double-submit CSRF tokens — works, more state.
Recommendation: First option, with a start gate that fails if Secure cannot be guaranteed in production.
Challenges: 16 Q19/Q10 gates.

## Q52 [Impl] Login state, PKCE and nonce storage across instances
16 Q16 moves in-process auth state to Postgres. The login flow has state, nonce, PKCE verifier, return-URL and, in device flow, user and device codes.
Example: Instance 2 receives the callback; the state record is in memory on instance 1; it answers "invalid state" and the user retries four times.
Options:
- Postgres rows with TTL 10 min, single use (delete on read) — standard.
- Signed stateless state parameter — fewer writes, replay worries.
- Sticky sessions — rejected in 16 Q16.
Recommendation: Postgres rows, single-use, with periodic cleanup, and a test with callbacks on a different instance.
Challenges: 16 Q16.

## Q53 [Impl] Open redirect and return-URL handling after login
Post-login redirect parameters are a classic phishing vector, and the CLI device flow adds URLs in approval pages.
Example: `https://mice.example.com/login?next=https://mice-example.evil.test` redirects the user after a valid login.
Options:
- Accept only relative paths or an allow-list of origins, store the target server-side keyed by state — secure.
- Sign the `next` parameter — works, more key handling.
- Disallow `next` altogether — breaks deep links.
Recommendation: Server-side stored relative-path-only target.
Challenges: Q15 phishing.

## Q54 [Impl] JWKS fetching, caching and key rollover of the IdP
Q9 now requires signature verification always. IdP keys rotate; fetches fail; caches go stale.
Example: The IdP rotates its signing key at 02:00. Instance 3 has a 24 h cache and rejects every login for 3 hours; instance 1 refreshed on unknown `kid` and works.
Options:
- Refetch on unknown `kid` with rate limit and a bounded cache (1 h), alert on persistent failures — resilient.
- Fixed pinned keys — breaks on rotation.
- Fetch every request — slow, fragile.
Recommendation: Option 1, shared cache state in Postgres or per instance with jitter, and a startup check.
Challenges: Q9; ADR draft on id_token verification.

## Q55 [Impl] Clock skew tolerance in token validation
`exp`, `nbf`, `iat` and `auth_time` need tolerances. Q7 sets the callback receipt time as anchor, but id_token claims still use time.
Example: The BFF clock is 90 s ahead; every id_token with `nbf` is "not yet valid" for the first 90 s and users get random login failures.
Options:
- A small fixed leeway (≤60 s) plus startup/readiness skew check from 16 Q12 — controlled.
- Larger leeway (5 min) — hides skew, weakens replay windows.
- No leeway — fragile.
Recommendation: ≤60 s leeway, with the skew gate from 16 Q12.
Challenges: Q7; 16 Q12.

## Q56 [Impl] Refresh-token handling for CLI credentials
Q5 gives CLI credentials 8–24 h, refreshable. Refresh tokens are the highest-value secret on a laptop.
Example: A stolen refresh token from a keychain backup is used 3 weeks later from another country; each refresh issues new tokens indefinitely.
Options:
- Rotating single-use refresh tokens with reuse detection (revoke family on reuse), absolute cap of 30 days — industry practice.
- Long-lived reusable refresh tokens — simple, risky.
- No refresh; re-login at expiry — secure, annoying daily.
Recommendation: Rotation with reuse detection and an absolute lifetime cap.
Challenges: Q5, Q14.

## Q57 [Impl] Credential binding to the issuing remote and device
Credentials are bound to the issuing remote (00). Without device binding a copied keychain item works anywhere.
Example: A malware reads `~/.mice/credentials` on a lab PC and uses it from a server.
Options:
- Bind to a device key (stored in keychain/TPM) with proof-of-possession on each request (DPoP-style) — strong, complex.
- Bind to client IP range — brittle.
- Rely on keychain protection only — weak against same-user malware.
Recommendation: Start with keychain storage + short TTL + reuse detection; plan DPoP for regulated use. Decide the cut-off explicitly.
Challenges: Q14.

## Q58 [Impl] Device-flow endpoint hardening beyond Q15
The device endpoints are unauthenticated and brute-forceable.
Example: An attacker polls `/device/token` with random `device_code` values at 500 req/s.
Options:
- High-entropy codes (≥128 bit), user codes with limited alphabet and lockout after 5 wrong entries, per-IP/per-client throttles, slow_down responses — standard (RFC 8628).
- IP allow-listing of internal networks — fragile.
- Disable device flow in production — blocks CLI.
Recommendation: RFC 8628 compliance with tests for each throttle and expiry path.
Challenges: Q15, Q24.

## Q59 [Impl] How is the revocation generation read without adding 5–10 ms per request?
Q3/Q4 chose DB time, a monotonic generation and ~2 s cache. At 50 mutations/s and heavy GET load, per-request DB reads multiply.
Example: 3 instances × 200 req/s = 600 indexed reads/s plus last-used writes; during a failover each request pays a timeout.
Options:
- Per-instance 2 s cache refreshed in the background with Postgres NOTIFY invalidation — fast, tiny window.
- No cache, one indexed read — simple, higher DB load (15 Q21 selected this).
- Redis cache — another dependency in the fail-closed path.
Recommendation: Resolve the contradiction between Q4 (2 s cache) and 15 Q21 (no cache). Pick one; state the stale bound as the guarantee.
Challenges: Q3, Q4 vs 15 Q18/Q21.

## Q60 [Impl] Last-used tracking and write amplification
Q4 throttles last-used writes to once a minute. Under N instances that is N writers on the same rows.
Example: A credential used by CI-like scripts every 200 ms is updated on 3 instances, causing row-lock contention and deadlocks.
Options:
- Update only when older than 60 s using a conditional UPDATE — few writes.
- Buffer in memory and flush every minute — may lose last-used on crash.
- Don't track last-used; rely on audit — loses a security signal.
Recommendation: Conditional update, tested under concurrency.
Challenges: Q4.

## Q61 [Impl] Group claims, directory lookups and failure modes
Q17 fetches groups server-side; Q18 rechecks with max staleness. The directory is yet another outage dependency.
Example: Graph/LDAP times out for 40 s during login; 300 users can't sign in during the 08:00 rush.
Options:
- Cache groups in Postgres with a staleness bound (for example 15 min); on directory failure use cached groups if within bound, otherwise deny — resilient and bounded.
- Block login when the directory is down — strictest.
- Use only token claims — fragile (overage).
Recommendation: Cached groups with bound plus circuit breaker; fail closed beyond bound.
Challenges: Q17, Q18, 15 Q16.

## Q62 [Impl] Group renames, duplicates and issuer binding
02 binds groups by IdP group id + issuer. Display names collide or change.
Example: "QA" exists in two directory domains with different ids. A bootstrap rule matches by name "QA" and grants access to both.
Options:
- Match rules strictly by group id (object id) and keep names for display only, validated in the admin UI — safe.
- Match by name case-insensitively — easy, ambiguous.
- Both with a conflict warning — transitional.
Recommendation: Id-only matching, case rules documented and tested (15 Q28).
Challenges: 02, 15 Q9.

## Q63 [Impl] Principal table: identity of record and uniqueness constraints
Everything keys on iss+sub, but strings vary (trailing slash in `iss`, case). A canonicalisation bug creates two Principals for one person.
Example: Some tokens carry `https://login.example.com/` and others without the slash; the user gets two Principals with different grants.
Options:
- Canonicalise iss once at config time, store an internal numeric id as FK, unique constraint on (canonical iss, sub) — standard.
- Store the raw strings as keys — fragile.
- Hash the pair — opaque.
Recommendation: Internal id + unique constraint + canonicalisation tests.
Challenges: 13 Q19.

## Q64 [Impl] The commit trailer carrying iss+sub: format, spoofing and size
Both iss+sub in oxen trailers and in audit were agreed ("both"). Trailers live in oxen commit messages that a client can influence.
Example: A malicious client pushes a commit message with a forged `Mice-Actor:` trailer; the BFF concatenates its own trailer and a parser reads the first one.
Options:
- BFF strips any client-supplied reserved trailers and appends its own last; the parser reads the last; unit-tested — secure.
- Reject commits containing reserved trailers — strict, breaks imports.
- Store only in audit — contradicts "both".
Recommendation: Strip-and-append with verification against the audit record.
Challenges: Q10 vs Q28.

## Q65 [Impl] Logout, back-channel logout token handling and replay
Q2 adopts back-channel logout. The endpoint is unauthenticated and receives signed JWTs.
Example: An attacker replays a captured `logout_token` to log a victim out repeatedly (denial of service) or sends a token with `sid` of another session.
Options:
- Validate signature, `iss`, `aud`, `events` claim, `jti` uniqueness (stored with TTL) and map `sid`/`sub` to Sessions — standard.
- Accept any valid signature — replayable.
- Disable — contradicts Q2.
Recommendation: Full validation with `jti` replay cache in Postgres.
Challenges: Q2.

## Q66 [Impl] Authentication error contract: leaks, codes and timing
Error text can reveal whether a Principal exists, is revoked, or is lacking MFA.
Example: `/token` returns "Principal revoked" vs "invalid credential"; an attacker enumerates departed staff.
Options:
- Uniform external error with stable internal codes logged and audited; distinct codes only after successful authentication — standard.
- Distinct messages for usability — leaks.
- Constant-time comparisons and uniform latency for secrets — add to either.
Recommendation: Option 1 plus constant-time secret checks and tests.
Challenges: Q23, 15 Q24 (error codes).

## Q67 [Impl] Bootstrap admin: recovery when no admin remains and the IdP group is gone
Q25 audits recovery when no admin remains, but how does it run in Kubernetes without a shell?
Example: The only admin group is deleted in the IdP; a restart with an environment variable "BOOTSTRAP_ADMIN_SUB" is the only way, but 16 Q10 forbids insecure defaults.
Options:
- A signed, one-time recovery token created by operators (two-person), valid for 1 h, audited — controlled.
- Environment variable at start with audit event, removed afterwards — simple, secret in manifests.
- Database edit by DBA — bypasses audit (16 Q11 forbids).
Recommendation: Two-person recovery token, audited, time-boxed.
Challenges: Q25, 16 Q11.

## Q68 [Impl] Test strategy for authentication through the HTTP boundary
Tests are black-box HTTP against real containers. Authentication involves a real or mock IdP, clocks and multiple instances.
Example: A test for step-up freshness needs `auth_time` 6 minutes ago; the mock IdP can't produce it and the test is skipped.
Options:
- A test IdP container (for example Keycloak/oidc-server-mock) configurable per test for claims and time, plus a controllable BFF clock offset in test stacks only (16 decision) — realistic.
- Stubs inside the BFF — easy, bypasses real validation.
- Manual testing — not acceptable under validation.
Recommendation: Option 1 with a table-driven suite (iss canonicalisation, JWKS rollover, refresh reuse, back-channel replay, two-instance revocation).
Challenges: 16 Q28; 15 Q28.

## Decisions log

| Q | Answer | Date |
|---|--------|------|
| Q29 | Single IdP, IdP change UNSUPPORTED (confirmed; 13 Q11, 14 Q22, 15 Q16 migration tooling to be marked moot) | answered |
| Q30 | Require person-account claim; refuse otherwise; record in signature | answered |
| Q31 | Auto-provision all (RISK: guest/alias match; see round 3 Q69) | answered |
| Q32 | Re-enabling the IdP account restores access with no review (CONFIRMED by owner) | answered |
| Q33 | Inspectors use the Auditor role; external users supported via the single IdP (CONFIRMED; supersedes escort-only) | answered |
| Q34 | Logout always revokes everything (web + CLI + Desktop) | answered |
| Q35 | Keychain keyed by Principal + acting-as banner + write confirmation | answered |
| Q36 | Fresh authentication per signature | answered |
| Q37 | Job token at submission; submitter-still-active check at commit | answered |
| Q38 | REVISIT (see round 3 Q70) | answered |
| Q39 | ACCESS_REVOKED code; partial uploads discarded | answered |
| Q40 | Name snapshot + name history + same-person link | answered |
| Q41 | Separate security log ~90 d; hashed pointer in immudb | answered |
| Q42 | Security role suspend + 2nd admin confirm 24h; self-suspend | answered |
| Q43 | Refuse signing without MFA evidence; IdP profile in qualification | answered |
| Q44 | One-time e-signature declaration, versioned digest in immudb | answered |
| Q45 | Periodic IdP baseline check + joint change process | answered |
| Q46 | Never impersonate | answered |
| Q47 | Externals use the SAME IdP (guests, enforced MFA, expiry); no second IdP, no multi-issuer design (CONFIRMED) | answered |
| Q48 | Pseudonymised ids; erasable mapping; legal confirms | answered |
| Q49 | Server-side Session rows; opaque cookie id | answered |
| Q50 | Key-ring with rotation schedule (reverses Q16) | answered |
| Q51 | __Host-, Secure, SameSite=Lax, Origin checks, mutation header, start gate | answered |
| Q52 | Postgres single-use state, TTL 10 min | answered |
| Q53 | Server-side relative-path return target | answered |
| Q54 | IdP always available; always check; if not available, no access (CONFIRMED) | answered |
| Q55 | 5 min leeway (RISK: weakens replay window; recommended <=60 s) | answered |
| Q56 | Rotating refresh + reuse detection; 30 d cap | answered |
| Q57 | Keychain + short TTL + reuse detection; DPoP planned with cut-off | answered |
| Q58 | RFC 8628 hardening, tested | answered |
| Q59 | 2 s cache + NOTIFY; reconcile with 15 Q21 | answered |
| Q60 | Conditional UPDATE >60 s | answered |
| Q61 | Login blocked when IdP/directory is down (CONFIRMED) | answered |
| Q62 | Group object id matching only | answered |
| Q63 | Canonical iss, internal id FK, unique constraint | answered |
| Q64 | Strip+append trailer; verify vs audit | answered |
| Q65 | Full back-channel logout validation + jti replay cache | answered |
| Q66 | Uniform errors; constant-time checks | answered |
| Q67 | Two-person recovery token 1 h | answered |
| Q68 | Test IdP container + clock offset; table-driven suite | answered |

## Round 3 decisions
Q69–Q83 answered; see "Round 3 decisions" in spec.md.

---

# Known Issues and Conflicts

## Cache Conflicts
- **Q4 vs 15-Q18/Q21**: Short-TTL cache (2s) conflicts with no-cache requirement. Stricter reading is no cache. Cross-spec reconciliation needed with 02 (authorization staleness) and 15 (administration).
- **Q59**: 2s cache with NOTIFY needs reconciliation with 15-Q21 (per-request revocation read).

## Cross-Spec Attribution Conflict
- **Q10 vs Q28**: Oxen commit trailers hold `iss|sub` for humans only. Job commits (automation) have no trailer and are attributed through audit `via` alone. Impacts 08 (workspaces) and 09 (jobs) specs.

## Risks Accepted by Owner
- **Q1 (IdP outage grace period)**: Live check kept only for short-lived CLI credentials. Revoked users may stay active during IdP outage (bounded grace period).
- **Q16 (secret leak)**: No key-rotation tooling. Secret leak requires logging everyone out.
- **Q21 (immudb fail-closed)**: No logins or revokes while immudb is down. Break-glass declined. Incident-response gap noted in 15-Q7.
- **Q20 (running Jobs)**: Running Jobs finish but result commit blocked on revocation. Held output follows 04-Q12 and 08-Q11.

## MFA Evidence Requirement
- **Q6 and 04-Q4**: If IdP exposes no `acr`/`amr` claims, step-up is refused for signing. IdP must be validated before use. Blocks 04 (gxp-compliance) signing ceremony.

## Pending Confirmations
- **Q26**: PENDING owner confirmation that no live credentials, cookies, or cut-offs exist in current deployment.

## Service Principal Removal
- **Q12, Q13, 00-Q19**: Service principals removed per spec. References in 02 (authorization) stories 11-12 and specs 12-14 are now obsolete and need cleanup.

## Implementation Status
- Step-up re-authentication: ✅ Core implemented, ❌ MFA evidence extraction (acr/amr) pending
- Signing ceremony primitives: ✅ Auth layer complete, integration owned by 04 (gxp-compliance)
- Device flow: ✅ Implemented
- Web sessions UI: ✅ Complete
- Admin revocation UI: ✅ Complete

# Impact on Other Specs

## Provides Foundation For

### 02 - Authorization
- **Principal identity** (`iss|sub`) used as authorization subject
- **Session validation** required before authorization checks
- **Revocation state** checked during permission evaluation
- **Staleness bounds** must align (Q18, 02-Q12, 15-Q21)

### 03 - Audit
- **Principal identity** for audit actor attribution
- **Authentication events** (login, logout, revoke) logged to immudb
- **Fail-closed requirement**: No mutations when immudb down (Q21)
- **Via field** distinguishes session vs credential vs job-token

### 04 - GxP Compliance
- **Step-up re-authentication** provides fresh identity proof for signatures
- **MFA evidence** extraction (acr/amr) required for signing ceremony (Q43, 04-Q4)
- **E-signature declaration** stored in immudb (Q44)
- **Fresh authentication** requirement (60s) enforced by auth layer

### 07 - CLI
- **Device flow** authentication for CLI users
- **Scoped credentials** with repository-id and action scopes
- **Keychain storage** for short-lived tokens
- **Step-up via device flow** for sensitive CLI actions

### 08 - Workspaces (Desktop Sessions)
- **Session tokens** for Desktop Session authorization
- **Revocation** terminates active Desktop Sessions (user story #11)
- **Job tokens** issued at submission, validated at commit (Q37)
- **Commit attribution** via audit `via` for Job automation (Q10, Q28)

### 09 - Jobs
- **Job tokens** (BFF-internal) for automated job execution
- **Submitter identity** captured at submission, checked at commit (Q37)
- **Revocation** blocks result commits from running Jobs (Q20, user story #11)
- **No commit trailer** for automation (Q28)

### 10 - Sessions (Desktop)
- **Revocation** triggers Desktop Session termination
- **Principal identity** for session ownership
- **Access states** (active/revoked) control session validity

### 15 - Administration
- **Admin revocation** triggers directory sync and back-channel logout
- **Instance admin** role gates admin operations
- **Cache reconciliation** needed (Q59 vs 15-Q21)
- **Incident response** gap during immudb outage (Q21, 15-Q7)

## Depends On

### 00 - Cross-Cutting
- **Principal identity** decision (`iss|sub` as key)
- **Service principal removal** decision (impacts all authorization)
- **Audit fail-closed** requirement
- **GxP strict mode** always-on decision

### External Dependencies
- **IdP (OIDC provider)**: Keycloak in dev, external IdP required in production
- **PostgreSQL**: Session storage, credential storage, login state
- **ImmuDB**: Audit events, authentication events, signature records
- **Directory service**: Group membership, user provisioning, revocation sync

## Blocking Relationships

**Blocks implementation of:**
- 04 (gxp-compliance) - signing ceremony (needs MFA evidence extraction)
- 07 (cli) - CLI step-up (device flow integration pending)
- 08 (workspaces) - Job token validation (commit identity complete, trailer integration pending)

**Blocked by:**
- IdP MFA evidence exposure (acr/amr claims) - blocks 04 signing ceremony
- Owner confirmation on migration cut-off (Q26) - deployment prerequisite

## Cross-Spec Cleanup Required

**Service principal references to remove:**
- 02 (authorization) - stories 11-12 mention service principals
- Specs 12-14 - service principal references obsolete (Q12, Q13, 00-Q19)

**Staleness alignment needed:**
- 01-Q18, 02-Q12, 15-Q21 - single staleness figure must be shared

**Commit attribution:**
- 08, 09 - must document that automation has no commit trailer (Q28)


