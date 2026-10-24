# 07: PAT access is the intersection of scopes and current grants

**What to build:** A PAT's effective access is its scopes intersected with the minting user's current direct grants, evaluated on use. Group-derived access stays as snapshotted at mint until credentials are revoked.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Removing a user's direct repo role immediately removes it from their PATs
- [x] A PAT never exceeds its scopes
- [x] Group-derived access behaviour is unchanged and documented
- [x] TC-AUTHO-13 still passes; new tests cover shrinking
