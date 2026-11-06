# 19: Cross-store integrity verification

**What to build:** A scheduled job cross-checks signature records against audit events and oxen commit existence, producing a report. It is report-only: it never deletes or repairs. Alerts fire on findings.

**Blocked by:** 01; repositories/03

**Status:** ready-for-agent

- [ ] Scheduled verification covers signatures ↔ audit ↔ oxen
- [ ] Output is a report; nothing is deleted or repaired
- [ ] Findings raise an operator alert
- [ ] Each run is itself auditable
