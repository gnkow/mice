# 09: Revocation notifications

**What to build:** When a signature or its commits are revoked, the namespace Owners and the original signer are notified.

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] Owners of the namespace are notified on revoke
- [ ] The original signer is notified on revoke
- [ ] Notification carries enough context to find the signature, repository and reason
- [ ] Notification failure does not roll back the revocation record
