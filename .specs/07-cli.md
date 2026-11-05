Status: ready-for-agent

# 07 — `mice` CLI (PLAT-CLI)

## Problem Statement

Scientists need a CLI that authenticates against Mice and covers repositories, jobs, stages, favorites and notifications, with predictable behaviour and no silent version skew.

## Solution

A Node-based `mice` CLI, version-pinned to the BFF, with conventional option precedence, registry-generated help and a handshake that fails clearly on mismatch.

## User Stories

1. As a scientist, I want `mice login` via device flow, so that I authenticate without copying tokens.
2. As a scientist, I want `--remote` to override `MICE_REMOTE`, which overrides my config, so that precedence is conventional.
3. As a scientist, I want `--help` to print to stdout with exit code 0, so that piping works.
4. As a scientist, I want frozen exit codes and a versioned JSON output schema, so that scripts are reliable (no CI or service principals).
5. As a scientist, I want destructive commands such as `job reset` to confirm and fail closed without a TTY, so that I do not lose work.
6. As a scientist, I want `mice stage ...` for Oxen workspaces, so that naming matches the UI.
7. As a scientist, I want `stage` to be the only name for Oxen workspaces, with no `workspace` alias, so that naming is unambiguous.
8. As a user, I want a clear error when my CLI and the BFF versions differ, so that I know to upgrade; an audited emergency override exists.
9. As a scientist, I want `mice notifications` and `mice favorite` commands, so that I can use them from the terminal.
10. As a maintainer, I want commands registered in one registry that generates help, so that help and behaviour cannot drift.
11. As a security reviewer, I want the short-lived credential stored in the OS keychain with no PATs and no tokens on the command line, so that on-disk risk is reduced.
12. As a scientist, I want `MICE_VERSION` semantics documented, so that releases are predictable.

## Implementation Decisions

- Distribution is Node-only now (needs Node, `oxen`, Docker for jobs), served from the BFF itself; a binary release is later, with signed releases, provenance and checksum verified at handshake before regulated use.
- Compatibility is exact-match: the CLI is pinned to the BFF version; handshake fails with an upgrade message otherwise. An emergency override flag is allowed and audited. The CLI version is the API contract version; the HTTP API is versioned with deprecation headers, and the BFF may accept both versions during rollout.
- Option precedence: flag over env over config.
- Help goes to stdout when requested.
- Credentials are short-lived and session-scoped, stored in the OS keychain (inherited), bound to the issuing remote; environment-only tokens are used on shared PCs. No PATs, no service principals.
- The CLI can open merge requests and prints a browser step-up link; it never signs, approves or revokes (signatures only through browser step-up, 04). Pushes or commits to a validated branch are rejected; the CLI pushes to a non-validated branch and opens a merge request. Automation cannot approve.
- The CLI version equals the API contract version; `MICE_VERSION` semantics follow it.

## Testing Decisions

- CLI e2e against a stub BFF and against the real stack; contract tests replay the stub against the real BFF; an OS support list is maintained.
- Registry makes dispatch unit-testable by external behaviour (exit code, stdout/stderr).
- Prior art: existing CLI tests and TC-CLI-16.

## Out of Scope

Binary distribution, CI or service-principal use, backward-compatibility window beyond the emergency override.

## Further Notes

Exact-match pinning plus signed releases requires a release process.

Open grilling questions: see questions.md in this folder.

## Alignment with 04 (2026-11-05)

- Q18 is closed: signing happens only in the browser with step-up; the CLI opens merge requests and shows the step-up link; no CLI/device-flow signing, no PATs, no automated merges. Supersedes the "maintain user signs at merge" wording and Q18 options.
- Validated branches (default branch always) reject CLI pushes and local-merge pushes (05 Q13); CLI work lands on a non-validated branch plus merge request.
- Admin/audit step-up (Q17) is unchanged; approver role replaces `maintain` for signing.

## Decisions from grilling

Version and release
- Strict exact pin with an emergency override, audited (owner chose this over an N-1 window) (Q1).
- CLI name, version and build id on every request, recorded on audit; signed releases before regulated use (Q2, Q22).
- Per-request version header and validation; the BFF accepts both versions during rollout (Q3).
- The handshake returns the supported oxen client range; the CLI checks at login and before push or clone (Q4).
- CLI version equals API contract version (Q20); the HTTP API is versioned with deprecation headers, CLI pin on top (Q25).
- Signed releases, provenance and checksum verified at handshake before regulated use (Q24).

Credentials and step-up
- Credential bound to the issuing remote; the resolved remote is printed on authenticated commands (Q7).
- Short-lived session-scoped credentials; login refused if another identity's credential exists; environment-only tokens on shared PCs (Q16).
- Admin and audit commands need fresh device-flow step-up with minutes-lived tokens (Q17).

Behaviour and evidence
- Print the intent_id; distinguish refused from outcome unknown; never auto-retry (Q9).
- Frozen exit codes plus a versioned JSON schema (Q10).
- The BFF operation catalog is consumed by the CLI now; contract tests optional (Q11).
- Local job records are unverified and excluded from validated views; policy digest pinning plus registry allowlist (Q12).
- `job reset`: dry-run list, recoverable stash, confirmation (Q13).
- BFF receive time is authoritative; skew is flagged, not rejected (Q15).
- Contract tests replay the stub against the real BFF, plus an OS support list (Q19).

Inherited (not restated): Q5, Q6, Q8, Q14, Q18, Q21, Q23, Q26, Q27.

## Conflicts and open risks

- Q1: the emergency override weakens the exact pin and needs a strict audit and a named approver. OVERRODE (owner chose it over N-1).
- Q5 cites OS keychain from 01 Q5, but 01 Q5 only says short-lived credential and no long-lived PATs and does not mention keychain. The spec follows keychain; confirm in 01. RISK.
- Q11: owner wants the operation catalog consumed by the CLI now, which is larger than the recommended contract tests only. RISK.
- Q16: environment-only tokens on shared PCs remain exposed to process inspection. RISK.
- Q25 and 05 Q25: the CLI must translate names and clone URLs through the BFF because physical oxen names are static.
- Q14: no `workspace` alias, consistent with 00 Q16.
- Q8: no automation reasons, consistent with service principals removed; jobs use BFF-internal tokens.
- Q12: local job records are unverified; validated views must exclude them (04 Q26 traceability).
- Q4 depends on 00 Q27 (oxen pinned by image digest).

---

# Open Questions


Status: spec is ready-for-agent, but its central compatibility decision (exact-version pin, Node-only) is untested against how scientists, CI and validated environments actually install and upgrade tools.
Biggest risks: lockout on every BFF upgrade or rollback, plaintext PATs with admin power on laptops, client-asserted local job provenance, and the same word "workspace" meaning two different things during the Stage migration.
Questions are tagged [Domain] or [Impl]; each lists options and a recommendation so the owner can answer quickly.

## Q1 [Impl] Does exact-match pinning mean a lockout on every BFF deploy and rollback?
The owner chose that the CLI is pinned to the BFF version and the handshake fails on any difference. Every BFF release, including a one-line hotfix, then invalidates every installed CLI at the moment of deploy, and a BFF rollback does the same in the other direction. Nothing in the spec says whether patch versions count or whether read-only commands are also blocked.
Example scenario: Friday 17:30 the BFF is hotfixed from 0.4.1 to 0.4.2; 60 scientists with 0.4.1 get "upgrade required" while a 12-hour overnight push script fails at 02:00.
Options: (a) exact match on major.minor, tolerate patch; (b) exact match everywhere with a staged rollout window where the BFF accepts N and N-1; (c) exact match plus an emergency override flag. Trade-off: (a) breaks "no silent skew" for patches; (b) needs a window decision; (c) weakens the guarantee.
Recommendation: (b) with a configurable window, default one previous version.
Challenges: "Compatibility is exact-match" and "Backward-compatibility window" in Out of Scope.

## Q2 [Domain] Is the CLI version part of the validated state, and who controls what is installed on a scientist's machine?
Exact pinning looks like a validation feature, but the CLI is installed by individuals with Node and npm on laptops, outside any IT change control. Annex 11 expects defined configuration of the system and that changes are controlled. A pin check at runtime tells you something is wrong, not that the installed copy is the validated one.
Example scenario: An auditor asks which CLI version produced a push in March; nobody can show it, because the installed CLI was built from a branch checkout, not a release.
Options: (a) send CLI version and build id on every request and record it on audit events; (b) require installation from a signed, published release only; (c) leave to local IT. Trade-off: (a) is cheap; (b) needs a release pipeline.
Recommendation: (a) now, (b) before any regulated use.
Challenges: "Node-only now (needs Node, oxen, Docker for jobs)"; "Exact-match pinning plus later binary distribution will require a release process".

## Q3 [Impl] How does the handshake behave in a rolling upgrade with N BFF instances?
With N instances during a rolling deploy, two versions are live at once. The CLI's handshake may hit one version and the next call another, producing flapping failures. The existing cli-info endpoint is unauthenticated and per-instance; a handshake that runs before each command costs a round trip.
Example scenario: Maya runs three commands in a row during a rollout and gets two successes and one "version mismatch" depending on the instance she lands on.
Options: (a) handshake per command, with the BFF accepting both versions throughout the rollout; (b) handshake once per login and cache; (c) version header on each request and per-request rejection. Trade-off: (a) is simple; (c) is robust but needs header discipline on every client.
Recommendation: (c), with (a)'s acceptance window.
Challenges: "handshake fails with an upgrade message otherwise" assumes one BFF.

## Q4 [Impl] Who pins the oxen binary version, which the CLI shells out to for everything else?
The CLI pins itself to the BFF, but all passthrough commands run whatever oxen binary the user has installed, against an oxen-server of a specific version. Behaviour differences in oxen (hash, protocol, commit metadata) are exactly the kind of silent skew the pin was meant to prevent, and the spec does not extend the check.
Example scenario: A scientist upgrades oxen to a newer client and pushes data whose hashing differs from what the server expects, producing a corrupt-looking repository.
Options: (a) handshake returns a supported oxen version range and the CLI checks it at login and before push/clone; (b) bundle oxen; (c) document only. Trade-off: (b) breaks "Node-only".
Recommendation: (a).
Challenges: "CLI exact-version pin, Node-only" covers only half of the toolchain.

## Q5 [Domain] Is a plaintext PAT file acceptable for GxP users, given oxen stores the token in plaintext as well?
The credentials file has restrictive permissions, and PATs have an expiry, but oxen's own config keeps the token in plaintext regardless. Keychain storage was deferred. Part 11 expects controls against unauthorised use of credentials; a copied laptop disk or a backup of the home directory exposes a long-lived credential that was minted by an MFA-protected browser login.
Example scenario: A laptop backup to a consumer cloud service contains Dana's PAT; it stays valid for 90 days.
Options: (a) short PAT lifetime (hours to days) with silent refresh by device flow; (b) keychain for the Mice file only; (c) accept the risk and document it. Trade-off: (a) adds login friction in CI; (b) leaves oxen's copy.
Recommendation: (a), expiry short by default for interactive use, and note oxen's copy in the risk register.
Challenges: "Credentials remain in a permissioned file; keychain is a later option."

## Q6 [Impl] How does a CI pipeline or service principal authenticate when PAT minting is browser-only?
PAT minting is browser-only, device flow needs a human, and service principals are in scope now. The spec does not say how a service principal obtains a token for a CI runner or how it is rotated. A human mints a PAT, pastes it into a secret store and forgets it.
Example scenario: A nightly pipeline PAT minted by Wei expires; the pipeline fails silently for a weekend, or Wei leaves and manual offboarding revokes the credential that production depends on.
Options: (a) service principals issued credentials by an admin flow with explicit owner and expiry; (b) OIDC client-credential flow against the IdP; (c) humans mint PATs for automation. Trade-off: (b) is cleanest but needs IdP configuration.
Recommendation: (a) now, (b) as target.
Challenges: Spec says "non-interactive behaviour" but not how credentials arrive.

## Q7 [Impl] Can a misconfigured remote leak the PAT to the wrong host?
Precedence is changing to flag over env over config, and a PAT is sent to whatever remote resolves. A script that inherits an environment variable pointing at a staging or attacker-controlled host sends the production PAT there. Today the environment variable even outranks the flag, which means flags have been silently ignored.
Example scenario: A shared shell profile sets the remote to a test BFF; a scientist runs a command with the flag naming production and the PAT goes to the test host anyway.
Options: (a) bind each credential to the remote it was issued for and refuse others; (b) print the resolved remote on every authenticated command to stderr; (c) leave as is. Trade-off: (a) is stricter.
Recommendation: (a) and (b).
Challenges: "Option precedence: flag over env over config" (changes behaviour of existing scripts).

## Q8 [Domain] Does the mandatory reason survive automation, or does it become boilerplate?
Mutations require a reason; the CLI sends it for admin commands, job push and even oxen passthrough by stripping a flag. For scripted use there is a temptation to hardcode a string. The audit then carries a field that looks like a control but says nothing.
Example scenario: 4,000 audit events in a quarter carry the reason "automated", and an inspector asks what a mandatory reason adds.
Options: (a) allow environment-provided reasons only for service principals with registered purposes; (b) block empty or repeated boilerplate heuristically; (c) accept. Trade-off: (b) is brittle.
Recommendation: (a).
Challenges: Reason requirement carried through every CLI command with no policy for automation.

## Q9 [Impl] What does the user see when strict mode returns 503 on a mutation, and may the CLI retry?
Under strict mode every mutation fails closed with 503 if the Intent cannot be appended, and there are no automatic job retries. A 503 on a push or admin command is ambiguous to the client: refusal before the mutation, or an upstream failure after. Without a correlation id the scientist cannot tell whether to repeat.
Example scenario: A push returns 503; Rui re-runs it and creates a duplicate commit because the first attempt had actually reached oxen before the Outcome failed.
Options: (a) CLI prints the intent_id when present and distinguishes "refused before start" from "outcome unknown"; (b) never retry automatically, always print guidance; (c) retry idempotent calls only. Trade-off: (a) requires the BFF to return that distinction.
Recommendation: (a)+(b).
Challenges: "GXP_STRICT fail-closed for ALL mutations".

## Q10 [Impl] Are exit codes and output formats a public API, and what is frozen?
The spec promises predictable behaviour and clear exit codes. Today everything failing is 1; the plan proposed distinct codes by cause. Scripts will start depending on whatever ships. Without a statement of what is stable, every change is breaking or nothing can improve.
Example scenario: A pipeline treats exit 1 as "retry"; a later release introduces 4 for network errors and the pipeline stops retrying.
Options: (a) freeze a small documented set (0, usage, auth, network, server, refused-by-policy) and a JSON output schema versioned with the CLI; (b) document best-effort; (c) freeze nothing. Trade-off: (a) costs design effort.
Recommendation: (a).
Challenges: Decisions say "clear exit codes" without a contract.

## Q11 [Impl] How does the registry avoid becoming a second authorization table?
The registry declares auth requirement and confirm policy per command, and the admin groups mirror about fifteen areas of BFF routes. The server is default-deny; the registry's declarations are advisory yet visible to users as help. When an authz action changes server-side, the help lies.
Example scenario: The Stage resource migration changes required roles for stage commands; the CLI help still says a write role is enough and users see 403s.
Options: (a) the BFF publishes an operation catalog the CLI consumes; (b) contract tests compare registry and BFF routes; (c) manual sync. Trade-off: (a) is bigger up front.
Recommendation: (b) now.
Challenges: "commands registered in one registry that generates help".

## Q12 [Domain] Locally run jobs report client-asserted provenance; is that acceptable for GxP lineage?
The CLI runs jobs in local Docker and publishes job metadata after push. The BFF cannot verify the image digest, command, environment or result; everything is asserted by a laptop. A regulated analysis whose lineage says "container X ran on commit Y" is only as trustworthy as that laptop.
Example scenario: A scientist edits a container locally, tags it with a trusted name and pushes; lineage shows the trusted image.
Options: (a) mark locally run job records as unverified in lineage and exclude them from validated views; (b) require image digest pinning and registry allowlist at publish; (c) remove local jobs from the regulated profile. Trade-off: (c) hurts usability.
Recommendation: (a) now, (b) as policy.
Challenges: "A Job is a container run against a pinned Oxen commit" (verified nowhere for CLI jobs).

## Q13 [Domain] Is the job reset confirmation enough, given it can discard uncommitted scientific work?
Reset marks the job failed, cleans the work dir and may restore a dirty worktree, destroying changes unrelated to the job. A confirmation prompt or MICE_YES set globally in CI defeats it. The action is local and invisible to audit unless the BFF is called.
Example scenario: A scientist with two hours of uncommitted analysis edits runs reset to clean up a failed job and loses them.
Options: (a) refuse restore of unrelated changes and print the list first; (b) stash into a recoverable location; (c) keep prompt only. Trade-off: (b) adds storage.
Recommendation: (b) plus a dry-run list.
Challenges: "destructive commands ... confirm and fail closed without TTY".

## Q14 [Impl] Does the word "workspace" mean Stage or Mice Workspace in the CLI, and when?
The CLI spec says the workspace alias for Stages warns then retires. The workspaces spec, however, assigns the same word to the new overlay Workspaces and plans a command group for them. For the whole migration window the same command name could target a different resource type, including delete.
Example scenario: A script runs "workspace delete <id>" written for Oxen stages; after the Workspaces release it deletes someone's overlay workspace with unrecoverable uncommitted output.
Options: (a) retire the old alias before introducing the new group, with a hard error naming the replacement; (b) ids carry a type prefix and commands validate it; (c) a long overlap with warnings. Trade-off: (a) breaks old scripts at a known time.
Recommendation: (a)+(b).
Challenges: "the workspace alias to warn and then be retired" versus the Workspaces CLI plan.

## Q15 [Domain] Which clock and identity does a commit created locally carry?
The BFF performs Author injection on the server, but commits are created locally by oxen with local configured name, email and the laptop's clock. The remote history shows server-assigned authors while the local log shows something else. Contemporaneous (ALCOA) timestamps come from an uncontrolled client clock.
Example scenario: A clock-skewed laptop produces a commit dated two days in the future; an auditor compares it with the audit event time.
Options: (a) record BFF receive time as authoritative and flag skew beyond a tolerance; (b) reject pushes with future timestamps; (c) ignore. Trade-off: (b) can block legitimate offline work.
Recommendation: (a).
Challenges: "login ... runs oxen config for name and email" while the BFF overwrites authors.

## Q16 [Domain] What happens on shared instrument PCs where several scientists use one OS account?
One credentials file per OS user means the PAT of the last person to log in is used by everybody. Lab instrument computers are routinely shared with generic accounts. Attribution (the A in ALCOA) fails silently, and logout may not be performed.
Example scenario: Three analysts use "labuser" on a plate reader PC; every push is attributed to the person who logged in on Monday.
Options: (a) session-scoped credentials with short TTL and environment-only tokens for shared machines; (b) refuse login when a credentials file from another identity exists; (c) policy-only. Trade-off: (a) adds friction.
Recommendation: (a) with explicit guidance.
Challenges: New gap.

## Q17 [Domain] Should powerful admin commands exist in the CLI at all, with an unscoped PAT on disk?
About fifteen admin groups (roles, namespaces, audit export, instance admin) require an unscoped PAT. That makes the highest-privilege credential also the one stored in plaintext on a laptop and used by scripts. It also creates a large parity maintenance surface that mirrors every BFF admin change.
Example scenario: An instance admin's laptop is stolen; the PAT can add admins and export the entire audit log.
Options: (a) admin and audit commands require a fresh device-flow approval (step-up) and tokens with minutes of life; (b) remove admin groups from the CLI; (c) keep. Trade-off: (b) loses scripting; (a) is intermediate.
Recommendation: (a).
Challenges: "Unscoped PAT for management" and scope creep of mirroring the web UI.

## Q18 [Domain] Can a PAT-authenticated CLI perform the maintain-user signature at merge?
The owner decided e-signature equals the maintain user signing at merge. Part 11 requires signature components that re-authenticate the signer at signing. A PAT is a bearer token minted earlier; if the CLI can merge with it, the "signature" has no fresh authentication.
Example scenario: A maintainer's script merges 20 pull requests with a stored PAT; each is recorded as a signed approval.
Options: (a) signing merges require a browser re-authentication; (b) CLI can request a signature via device flow per merge; (c) allow PAT. Trade-off: (a) blocks automation of merges.
Recommendation: (b).
Challenges: "e-sig = maintain user signs at merge".

## Q19 [Impl] What is the CLI test strategy given dispatch has no coverage today?
The spec says CLI e2e runs against a stub BFF and against the real stack for happy paths. A stub drifts from the real BFF, which is exactly the skew the exact-version pin was meant to catch, so a green CLI suite can coexist with a broken release. The supported operating systems are also unspecified, and file permission semantics, path handling and the oxen binary differ on Windows.
Example scenario: The stub still returns an old response shape for whoami; every CLI test passes while the shipped CLI crashes against the real BFF.
Options: (a) contract tests that replay the stub's recorded responses against the real BFF in CI, plus a named OS support list; (b) real stack only; (c) both without synchronisation. Trade-off: (b) is slow but honest.
Recommendation: (a).
Challenges: Testing Decisions: "stub BFF and real stack".

## Q20 [Impl] What does tracking the root package version mean for CLI releases?
The default is that the CLI version follows the root package version. Then every BFF or web-only change bumps the CLI, and with exact pinning every user must reinstall for changes that did not touch the CLI. A separate train reintroduces the skew the pin was meant to eliminate.
Example scenario: A web-only fix ships as 0.7.3 and 80 scientists must upgrade a CLI that is byte-identical to the previous one.
Options: (a) CLI version equals an API contract version, bumped only on contract change; (b) root version always; (c) independent semver with a compatibility table. Trade-off: (a) needs discipline but makes the pin mean what it says.
Recommendation: (a).
Challenges: "MICE_VERSION tracking vs a separate release train is open; default is to track the root package version".

## Q21 [Impl] How quickly does an offboarding revoke take effect for CLI PATs across N instances?
Offboarding is a manual revoke by iss+sub. If PAT validation is cached per instance, a revoked token stays valid on some instances until caches expire. The departing person still has the PAT on their laptop, in oxen's config and possibly in CI secrets.
Example scenario: HR calls at 09:00, the admin revokes at 09:10, and a cached validation on instance 2 lets the user push at 09:25.
Options: (a) revocation read from PostgreSQL on every request; (b) a short cache with cross-instance invalidation; (c) accept lag up to the cache TTL. Trade-off: (a) adds a query per request.
Recommendation: (a), measured, with (b) only if latency demands.
Challenges: "admin revoke per iss+sub is the group-revocation path".

## Q22 [Domain] Should the client name and version be recorded in the audit trail?
Audit events carry the mechanism (session or PAT) but not which client or version performed the action. When a CLI bug corrupts metadata or a Python script misbehaves, an investigator needs to enumerate everything done by that version. The spec says no telemetry exists, which is a different thing from audit attribution.
Example scenario: A CLI release truncates metadata for a month; there is no way to list the affected actions without parsing user agents that were never stored.
Options: (a) client name and version recorded on every event; (b) on mutations only; (c) none. Trade-off: (a) is cheap but client-asserted.
Recommendation: (a), labelled as client-asserted.
Challenges: "Telemetry: none in code" carried as a feature.

## Q23 [Impl] How do large pushes through the BFF behave under per-request fail-closed auditing?
Push and clone use oxen's own protocol, which issues many requests per operation. If each mutating request needs an Intent event, a 40 GB push produces thousands of audit appends, and a transient immudb failure fails the operation at a random point. The CLI cannot resume an oxen push.
Example scenario: A 40 GB push with 10,000 requests loses three Intent appends during an immudb blip and aborts after two hours.
Options: (a) one Intent per push operation, grouped by the BFF; (b) per request; (c) exempt data requests. Trade-off: (c) contradicts "no class exempt"; (a) needs grouping logic.
Recommendation: (a), defined jointly with the data-transfer module.
Challenges: "GXP_STRICT fail-closed for ALL mutations".

## Q24 [Domain] How is the integrity of the CLI itself assured?
The CLI is plain Node ESM installed from the repository with no build or signing. It handles PATs, writes commits and publishes job metadata. Part 11 and Annex 11 expect controls against unauthorised system modification, and a tampered copy can exfiltrate credentials or alter data while still passing a version handshake.
Example scenario: A colleague shares a locally "improved" CLI that also posts tokens to a personal server; the handshake sees the right version number.
Options: (a) signed releases with provenance and a checksum the handshake can verify; (b) source install only with a controlled repository; (c) none. Trade-off: (a) needs a release pipeline.
Recommendation: (a) before regulated use.
Challenges: "Binary distribution" out of scope; release process deferred.

## Q25 [Impl] The pin covers the CLI; what about Python and other API clients?
PATs serve the CLI, Python and automation, but only the CLI has a handshake. Python scripts and notebooks call the same BFF contract unpinned. Exact pinning therefore protects one client while the others break silently on changes.
Example scenario: A BFF change alters a response field; the CLI reports a clear mismatch while a nightly Python notebook silently writes wrong values.
Options: (a) version the HTTP API itself with deprecation headers every client sees; (b) CLI only; (c) publish a Python client with the same pin. Trade-off: (a) is broader work but covers everyone.
Recommendation: (a).
Challenges: Compatibility scoped to a single client.

## Q26 [Impl] Does the CLI accept tokens on the command line?
Admin, job and meta commands accept a token flag. Command-line arguments leak through process lists, shell history, CI logs and crash reports, which undermines the permissioned credentials file. This is a standard exposure path next to a file stored with careful permissions.
Example scenario: A CI job echoes the command line into its log, readable by 200 engineers, including a live admin token.
Options: (a) remove the flag; (b) accept tokens only via stdin or environment with a deprecation period; (c) keep. Trade-off: (a) breaks existing scripts.
Recommendation: (b).
Challenges: Credential handling in the decisions; "PAT file permissioned 0600".

## Q27 [Impl] How is device flow protected against consent phishing?
An attacker starts a device flow, sends the short user code to a scientist and receives a PAT once the scientist approves it in the browser. If the approval page shows only a code, users approve by habit. The resulting credential is long-lived and not tied to the approver's machine.
Example scenario: A caller posing as IT support asks Lena to "enter this code"; she approves, and an attacker holds a 90-day PAT acting as Lena.
Options: (a) the approval page shows requesting IP, location, client name and hostname and requires a typed confirmation; (b) restrict device flow to the same network; (c) none. Trade-off: (b) breaks remote work.
Recommendation: (a), with short PAT lifetime.
Challenges: "mice login via device flow".

## Decisions log

| Q | Answer | Date |
| --- | --- | --- |
| Q1 | Strict exact pin with emergency override (owner chose over N-1 window); override flag audited | answered |
| Q2 | CLI name/version/build id on every request, recorded on audit; signed releases before regulated use | answered |
| Q3 | Per-request version header/validation; BFF accepts both versions during rollout | answered |
| Q4 | Handshake returns supported oxen client range; CLI checks at login and before push/clone | answered |
| Q5 | Inherited: OS keychain (01 Q5) | answered |
| Q6 | Inherited: no service principals/CI | answered |
| Q7 | Credential bound to issuing remote; print resolved remote on authenticated commands | answered |
| Q8 | Inherited: no automation reasons (SPs removed) | answered |
| Q9 | Print intent_id; distinguish refused vs outcome unknown; never auto-retry | answered |
| Q10 | Frozen exit codes + versioned JSON schema | answered |
| Q11 | Owner: BFF operation catalog consumed by CLI NOW (contract tests optional) | answered |
| Q12 | Local job records unverified, excluded from validated views; policy digest pinning + registry allowlist | answered |
| Q13 | Reset: dry-run list, recoverable stash, confirmation | answered |
| Q14 | Inherited: new project; stage only; 'workspace' = Mice Workspace | answered |
| Q15 | BFF receive time authoritative; flag skew; no reject | answered |
| Q16 | Short-lived session-scoped creds; refuse login if other identity credential exists; env-only tokens on shared PCs | answered |
| Q17 | Admin/audit commands need fresh device-flow step-up, minutes-lived tokens | answered |
| Q18 | Inherited: device-flow step-up (01 Q8) | answered |
| Q19 | Contract tests replay stub vs real BFF + OS support list | answered |
| Q20 | CLI version = API contract version | answered |
| Q21 | Inherited: 01 Q3 | answered |
| Q22 | Client name+version on every event, client-asserted | answered |
| Q23 | Inherited: 06 Q2/Q25 | answered |
| Q24 | Signed releases + provenance + checksum verified at handshake before regulated use | answered |
| Q25 | Version the HTTP API with deprecation headers; CLI pin on top | answered |
| Q26 | Inherited: no tokens on command line | answered |
| Q27 | Inherited: 01 Q15 | answered |

---

# Known Issues and Conflicts

## Emergency override weakens exact pin
- **Q1 (emergency override)**: OVERRODE recommendation; owner chose strict exact pin with audited emergency override over N-1 window. Weakens exact-pin guarantee but avoids lockout on every deploy. Emergency override must be audited, require named approver, and be rarely used. RISK: override can become routine if not policed.

## Keychain and credential handling
- **Q5 (OS keychain from 01 Q5)**: RISK. 01 Q5 only says short-lived credential and no long-lived PATs; does not explicitly mention keychain. Spec follows keychain storage; must confirm in 01 that keychain is the decision. Inherited from authentication decisions (01 Q5, authentication Q73, round 5).
- **Q16 (environment-only tokens on shared PCs)**: RISK. Remain exposed to process inspection (`ps`, proc filesystem). Better than file, worse than keychain. Short-lived session-scoped credentials mitigate.

## Operation catalog consumption now
- **Q11 (owner wants operation catalog consumed by CLI now)**: RISK. Larger than recommended contract-tests-only approach. BFF operation catalog must be stable and versioned. If catalog changes without CLI update, CLI behavior drifts. Contract tests (Q19) replay stub vs real BFF to catch drift.

## Local job records unverified
- **Q12 (local job records unverified)**: Client-asserted image digest, command, environment. Validated views must exclude local Jobs (04 Q26 traceability). Policy: digest pinning + registry allowlist at publish. Marked as unverified in lineage (09 Q12).

## Name translation dependency
- **Q25 and 05 Q25 (CLI must translate names and clone URLs through BFF)**: BLOCKER. Physical oxen names are static (stable ids). Display names map to ids in Postgres. CLI must resolve every repository name via BFF before oxen operations (clone, push). If 07 does not implement translation, repositories unreachable by name. Depends on 05 Q25.

## Workspace vs Stage naming
- **Q14 (no `workspace` alias)**: Consistent with 00 Q16 (new project, stage only). "workspace" retired for Oxen Stages; "Workspace" is Mice overlay Workspaces (08). No overlap during migration. Aligns with 08 Q28 (Stages review deferred).

## Automation and service principal removal
- **Q8 (no automation reasons)**: Consistent with service principals removed (01 Q12, Q13). Jobs use BFF-internal tokens (09 story 13). CLI does not support CI or service principals (Q6 inherited). Automated actions attributed to submitting Principal + Job marker (authentication T2).

## Oxen version pinning
- **Q4 (handshake returns supported oxen client range)**: Depends on 00 Q27 (oxen pinned by image digest). CLI checks oxen version at login and before push/clone. Protects against silent skew from mismatched oxen binary.

# Impact on Other Specs

## Blocks or dependencies
- **Blocks 05 (Repositories)**: Name translation (Q25/05 Q25) required. CLI resolves display names to stable ids via BFF. Clone URLs use display names; BFF translates.
- **Blocks 07 (CLI) internal**: Version pinning (Q1), credential binding (Q7), frozen exit codes (Q10), and operation catalog (Q11) define CLI contract.
- **Blocks 09 (Jobs)**: Local job records (Q12) client-asserted, excluded from validated views. CLI publishes job metadata after local push.

## Depends on
- **Depends on 00 (Cross-cutting)**: No service principals (Q6/Q8/00 Q19). Oxen pinning (Q4/00 Q27). Static repo names (Q25/05 Q25).
- **Depends on 01 (Authentication)**: Device-flow login (story 1, Q7). Short-lived credentials (Q5/01 Q5/authentication Q73). Keychain storage (Q5). Step-up for admin/signing (Q17, Q18/01 Q8). Credential bound to remote (Q7). No PATs (Q5).
- **Depends on 02 (Authorization)**: No PATs (inherited Q19). Credential scoping (02 Q19). No service principals (Q6/02 Q21).
- **Depends on 03 (Audit)**: Intent_id printed (Q9/03 Q21). Distinguish refused vs outcome unknown (Q9). Client name/version recorded (Q22).
- **Depends on 04 (GxP Compliance)**: Signed releases before regulated use (Q2, Q24/04 Q26). Local jobs excluded from validated views (Q12/04 Q26).
- **Depends on 05 (Repositories)**: Name translation (Q25/05 Q25). Static physical names; CLI resolves via BFF.
- **Depends on 06 (Data Transfer)**: Per-push Intent grouping (Q23/06 Q2/Q25). Large pushes grouped, not per-request audit.

## Cross-cutting impacts
- **00 (Cross-cutting)**: No service principals (Q6/Q8/00 Q19). Exact-pin with emergency override (Q1). Static names (Q25/05 Q25).
- **01 (Authentication)**: Device-flow (story 1/01 Q15). Short-lived credentials (Q5/authentication Q73). Keychain (Q5). Step-up (Q17/01 Q8). Credential-per-remote (Q7). Revocation (Q21/01 Q3).
- **02 (Authorization)**: No PATs (Q6/02 Q21). Credential scoping (02 Q19).
- **03 (Audit)**: Intent_id (Q9/03 Q21). Client name/version (Q22). Per-push grouping (Q23/06 Q2).
- **04 (GxP Compliance)**: Signed releases (Q2, Q24/04 Q26). Traceability matrix (04 Q26). Local jobs unverified (Q12).
- **05 (Repositories)**: Name translation (Q25/05 Q25). Clone URLs via BFF.
- **06 (Data Transfer)**: Per-push Intent (Q23/06 Q2/Q25).
- **07 (CLI) internal**: Version handshake (Q1, Q2, Q3, Q4, Q20, Q25). Frozen exit codes (Q10). Operation catalog (Q11). Credential handling (Q5, Q7, Q16, Q17, Q26). Local jobs (Q12).
- **08 (Workspaces)**: "workspace" name retired for Stages (Q14/08 Q28). Workspace = Mice overlay (08).
- **09 (Jobs)**: Local job records (Q12/09 Q12). Client-asserted provenance excluded from validated views.
- **10 (Sessions)**: No impact (CLI does not interact with Desktop Sessions).
- **16 (Operations)**: HTTP API versioned (Q25). Deprecation headers (Q25).

