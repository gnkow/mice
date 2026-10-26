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
