# 13: Read-Only Auditor Role

**What to build:** A new `read_only_auditor` instance permission that grants read access to all repositories but blocks all mutations. Intended for regulators, inspectors, and internal QA auditors during time-boxed audits. Admin assigns auditor permission with mandatory expiry date. Auditor can read any repository data, history, and audit logs, but cannot write, merge, delete, or modify anything. All auditor access is logged in the audit trail.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Add `read_only_auditor` to instance permissions enum
- [ ] Auditor permission requires mandatory expiry date (cannot be granted without expiry)
- [ ] Authorization checks: if user has `read_only_auditor`, grant read access to all repos
- [ ] Authorization checks: if user has `read_only_auditor`, block all mutations (write, merge, delete, settings)
- [ ] Admin UI: assign auditor role with date picker for expiry (required field)
- [ ] Expired auditor permissions automatically revoked
- [ ] Audit log: record all auditor access (read operations by auditor users)
- [ ] Tests verify auditor can read any repository
- [ ] Tests verify auditor cannot write, merge, or delete
- [ ] Tests verify auditor access expires on expiry date
- [ ] Tests verify auditor access is audited
