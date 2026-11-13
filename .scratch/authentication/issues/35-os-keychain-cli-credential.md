Status: done

# 35: OS keychain for the CLI credential

**Spec:** `.specs/01-authentication.md` (Q5, Q35, Q82) and `.specs/07-cli.md` (story 11)

## Outcome

`mice login` stores the device-flow credential (access token, refresh token, Principal `iss|sub`, and remote) in the OS keychain. On macOS that is one `security` item, service `mice`, account `cli-credentials`. A later command reads the entry for the resolved remote. The same Principal may have several remotes; a write then asks `Acting as <name> <email> at <remote>` (`--yes` or `MICE_YES=1` skips the prompt). A second Principal on the same OS user is refused. Logout removes that remote's entry and leaves the others. The secret is not written to `credentials.json` or `config.json`. `oxen config --auth` still receives the access token so oxen can authenticate. `MICE_PAT` no longer overrides the keychain (issue 48).

## Acceptance

- [x] `mice login` writes the credential to the OS keychain for that Principal and remote
- [x] A later command reads that entry back from the keychain
- [x] Several entries show an acting-as confirmation before use
- [x] Login of a second Principal on the same OS user is refused
- [x] The credential is not written to a world-readable config file

## Code

- `cli/lib/keychain.mjs`
- `cli/lib/login.mjs`
- `cli/lib/config.mjs`
- `cli/mice.mjs`

## Comments

2026-11-13: Checkmate audit — **holds** (acceptance green via `memoryKeychain` + login/config seams).

**Deepen (auto-pick):** Extract deep `credentialVault(backend)` over `{ read, write, clear }` (ports & adapters). Principal refusal and multi-remote row merge live once; memory and OS `security` adapters only touch secret bytes. Public Keychain seam stays `put` / `list` / `remove`.

**Files:** `cli/lib/keychain.mjs`, `cli/lib/keychain.test.mjs`

2026-11-13 Deep-API (integ): **holds**; deepen left as `credentialVault` (still Top). Added CLI package integ: login writes vault secret bytes → `resolveToken` / `credentialFor` read → logout clears; secrets stay out of `credentials.json`.
- **Seams:** `credentialVault` (unit) → login ↔ vault ↔ `resolveToken` (CLI package integ)
- **Integ:** `cli/lib/keychain.integration.test.mjs`
- **No commit/push** this pass.

2026-11-13: /deep-ui skipped — no-ui (API/CLI/boot acceptance only). User acknowledged skip on authentication deep-ui board.
