# 14: Suspend on owner offboarding, and reassign

**What to build:** When a service principal's owner is offboarded (directory sync or admin revocation), the principal is suspended, not deleted: its credentials are rejected so CI fails visibly, while its record and audit history remain. An instance admin can reassign it to a new owner and reactivate it without minting new credentials.

**Blocked by:** 13 (Service principals), 09 (Directory-sync revocation)

**Status:** done

- [x] Offboarding the owner suspends the principal and its PATs are rejected
- [x] The suspension is audited with its cause
- [x] Admin can reassign to a new owner and reactivate; the same PATs work again
- [x] A principal with an active owner is never suspended by this path
- [x] Tested with a stub directory client
