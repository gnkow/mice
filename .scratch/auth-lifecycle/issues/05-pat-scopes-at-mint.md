# 05: PAT scopes at mint (UI and CLI)

**What to build:** A User can set PAT scopes (namespace, optional repo, maximum role) when minting a token in Settings and with `mice`, and both explain what scopes mean. First verify what the UI and CLI already support, then fill the gaps. Scope data and enforcement already exist.

**Blocked by:** 01 (Scoped-credential predicate)

**Status:** ready-for-agent

- [ ] Settings can mint a PAT with one or more scopes
- [ ] `mice` can mint a PAT with scopes and its help text describes them
- [ ] A minted scoped PAT is capped to the chosen maximum role in the target repo and refused elsewhere
- [ ] The Settings token list shows each PAT's scopes
- [ ] Playwright (or CLI integration) covers minting and using a scoped PAT
