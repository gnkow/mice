Status: ready-for-agent

# 07 — `mice` CLI (PLAT-CLI)

## Problem Statement

Scientists and automation need a CLI that authenticates against Mice and covers repositories, jobs, stages, favorites and notifications, with predictable behaviour and no silent version skew.

## Solution

A Node-based `mice` CLI, version-pinned to the BFF, with conventional option precedence, registry-generated help and a handshake that fails clearly on mismatch.

## User Stories

1. As a scientist, I want `mice login` via device flow, so that I authenticate without copying tokens.
2. As a scientist, I want `--remote` to override `MICE_REMOTE`, which overrides my config, so that precedence is conventional.
3. As a scientist, I want `--help` to print to stdout with exit code 0, so that piping works.
4. As a CI author, I want non-interactive behaviour and clear exit codes, so that pipelines are reliable.
5. As a scientist, I want destructive commands such as `job reset` to confirm and fail closed without a TTY, so that I do not lose work.
6. As a scientist, I want `mice stage ...` for Oxen workspaces, so that naming matches the UI.
7. As a scientist, I want the `workspace` alias to warn and then be retired, so that migration is clear.
8. As a user, I want a clear error when my CLI and the BFF versions differ, so that I know to upgrade.
9. As a scientist, I want `mice notifications` and `mice favorite` commands, so that I can use them from the terminal.
10. As a maintainer, I want commands registered in one registry that generates help, so that help and behaviour cannot drift.
11. As a security reviewer, I want the PAT file permissioned `0600` and an expiry on PATs, so that on-disk risk is reduced.
12. As a scientist, I want `MICE_VERSION` semantics documented, so that releases are predictable.

## Implementation Decisions

- Distribution is Node-only now (needs Node, `oxen`, Docker for jobs); a binary release is later.
- Compatibility is exact-match: the CLI is pinned to the BFF version; handshake fails with an upgrade message otherwise.
- Option precedence: flag over env over config.
- Help goes to stdout when requested.
- Credentials remain in a permissioned file; keychain is a later option.
- `MICE_VERSION` tracking vs a separate release train is open; default is to track the root package version.

## Testing Decisions

- CLI e2e against a stub BFF and against the real stack for happy paths.
- Registry makes dispatch unit-testable by external behaviour (exit code, stdout/stderr).
- Prior art: existing CLI tests and TC-CLI-16.

## Out of Scope

Binary distribution, keychain storage, backward-compatibility window.

## Further Notes

Exact-match pinning plus later binary distribution will require a release process.
