# 13: Validation pack and clock-drift alert

**What to build:** Authentication ships with the evidence a regulated customer needs. It includes requirement-to-test traceability, a risk assessment, IQ/OQ evidence, and revalidation triggers. A clock-drift alert fires above 1 s.

**Blocked by:** 07 (CLI device login), 08 (commit identity and Job tokens), 10 (auditor access), 11 (IdP baseline and drift reports), 12 (quarterly access review and recovery)

**Status:** ready-for-agent

- [ ] Every authentication requirement maps to at least one automated test
- [ ] Risk assessment and IQ/OQ evidence are in the validation pack
- [ ] Revalidation is triggered by any IdP-baseline or auth-code change
- [ ] NTP drift above 1 s raises an alert
- [ ] IdP documented as a qualified supplier with a change-notification agreement
