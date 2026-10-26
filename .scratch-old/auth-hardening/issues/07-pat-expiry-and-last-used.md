# 07: PAT expiry and last-used

**What to build:** PATs require an expiry (default 90 days, max 365) and record last use, shown in Settings → CLI tokens. Existing PATs are grandfathered to 365 days from migration. Expired PATs are rejected by the BFF; CLI token minting supports the new field.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] Creating a PAT without expiry uses 90 days; over 365 is rejected
- [x] Expired PAT gets `401`
- [x] Last-used updates on use and is visible in Settings
- [x] Existing PATs get 365 days from migration, exactly once
- [x] CLI/device-flow minting still works
- [x] Playwright: `cli-auth` cases still pass
