# 11: IdP baseline and drift reports

**What to build:** Operators can prove the IdP still meets the regulated baseline (MFA, lockout, password policy). The baseline check runs at each deploy and daily; a daily drift report compares IdP and Mice access state; an alarm fires when a Principal holds sign rights while disabled in the IdP. An IdP outage is recorded as an incident.

**Blocked by:** 04 (live IdP check and access states), 05 (authentication event audit and failure alerts)

**Status:** ready-for-agent

- [ ] Baseline failure blocks deploy and raises an alert
- [ ] Daily drift report is stored as validation evidence
- [ ] Disabled-in-IdP Principal with sign rights triggers an alarm
- [ ] IdP outage creates an incident record referencing the manual (paper) procedure
