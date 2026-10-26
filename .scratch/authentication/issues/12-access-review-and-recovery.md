# 12: Quarterly access review and two-person recovery

**What to build:** Admins can show regular access review and recover from lockout without shared credentials. A quarterly report lists every Principal, role, grant and last login; a named reviewer signs it electronically. Two admins together can issue a 1 h recovery token.

**Blocked by:** 06 (revocation and suspension), 09 (signing ceremony)

**Status:** ready-for-agent

- [ ] Report generation and electronic signature through the signing ceremony
- [ ] Alert if unreviewed after 14 days
- [ ] Recovery token needs two distinct admins, is single-use and expires in 1 h
- [ ] All steps audited; recovery fails with 503 if the audit Intent cannot be appended
