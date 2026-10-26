# 05: PAT scopes at mint (UI and CLI)

**What to build:** A User can set PAT scopes (namespace, optional repo, maximum role) when minting a token in Settings and with `mice`, and both explain what scopes mean. First verify what the UI and CLI already support, then fill the gaps. Scope data and enforcement already exist.

**Blocked by:** 01 (Scoped-credential predicate)

**Status:** done

- [x] Settings can mint a PAT with one or more scopes
- [x] `mice` can mint a PAT with scopes and its help text describes them
- [x] A minted scoped PAT is capped to the chosen maximum role in the target repo and refused elsewhere
- [x] The Settings token list shows each PAT's scopes
- [x] Playwright (or CLI integration) covers minting and using a scoped PAT
