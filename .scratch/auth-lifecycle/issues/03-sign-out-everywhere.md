# 03: Sign out everywhere

**What to build:** A User can press "Sign out everywhere" on their Profile. All their other Sessions end; their PATs keep working unless they tick "also revoke my PATs". The action is Session-only (PATs cannot call it), same-origin protected, confirmed in the UI, and audited with the Principal and the source `self-service`.

**Blocked by:** 02 (Two-cut-off revocation)

**Status:** ready-for-agent

- [ ] Another Session of the same Principal is rejected after the action; PATs still work by default
- [ ] With the option ticked, PATs created at or before the action are also rejected
- [ ] The route rejects PAT callers and cross-origin requests
- [ ] The audit record carries the Principal and source `self-service`
- [ ] Playwright covers the Profile button and confirmation message
