# 01 — Authentication: grilling round 2 (Q29–Q68)

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
