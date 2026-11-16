# 09: Revocation notifications

**What to build:** When a signature or its commits are revoked, the namespace Owners and the original signer are notified.

**Blocked by:** 07

**Status:** done

- [x] Owners of the namespace are notified on revoke
- [x] The original signer is notified on revoke
- [x] Notification carries enough context to find the signature, repository and reason
- [x] Notification failure does not roll back the revocation record

## Comments

**Deep-api Close (2026-11-16):** `revokeSignature` emits a security notification to owners + original signer; notify errors are swallowed after the ledger append.
