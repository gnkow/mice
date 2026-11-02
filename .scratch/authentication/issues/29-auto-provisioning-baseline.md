Status: wontfix

# 29: Auto-provision grants at most a read-only baseline

**Spec:** `.specs/01-authentication.md` (U9, R1, Q69)

**Decision:** Authorization issue 11 removed `AUTHZ_GROUP_BOOTSTRAP`. There is no bootstrap map left to cap.

## Outcome

A first login creates a Principal and grants nothing, except an identity on `AUTHZ_BOOTSTRAP_ADMINS`, who becomes an instance admin. Write, sign, and admin arrive when an administrator approves an access request. An IdP group grants access only after an administrator has added that group to a namespace or repository.

## Acceptance

- [x] There is no `AUTHZ_GROUP_BOOTSTRAP` map to grant `view_audit`, write, or admin at login
- [x] A new Principal outside the bootstrap-admin list has no instance permissions and no namespace membership until an administrator grants them
- [x] A Principal in `AUTHZ_BOOTSTRAP_ADMINS` still receives instance admin
