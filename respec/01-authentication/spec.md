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
9. As a compliance lead, I want step-up re-authentication for sensitive actions, so that e-signatures rest on fresh proof of identity.
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
