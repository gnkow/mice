Status: ready-for-agent

# 35: OS keychain for the CLI credential

**Spec:** `.specs/01-authentication.md` (Q5, Q35, Q82) and `.specs/07-cli.md` (story 11)

**Blocked by:** 07 (the credential the keychain stores)

## What to build

The CLI stores the credential from issue 07 in the OS keychain, keyed by Principal and by the issuing remote. When several entries exist, the CLI shows who it is acting as and asks before a write. A second Principal logging in as the same OS user is refused.

## In code today

The live device flow returns a PAT from `cliDevice.ts` and does not write a keychain. `deviceFlow.ts` keeps a process-local `Map` named keychain and is not called by the CLI or the HTTP routes.

## Acceptance

- [ ] `mice login` writes the credential to the OS keychain for that Principal and remote
- [ ] A later command reads that entry back from the keychain
- [ ] Several entries show an acting-as confirmation before use
- [ ] Login of a second Principal on the same OS user is refused
- [ ] The credential is not written to a world-readable config file
