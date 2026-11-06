# 10: Intent → effect → outcome

**What to build:** Every mutation writes an audit intent, then takes effect, then writes an outcome. Failed outcomes are audited too.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Intent is written before the effect
- [ ] Outcome is written after the effect, including failed outcomes
- [ ] A mutation that never reaches an outcome is detectable as an orphan intent (reconciler is 12)
- [ ] HTTP tests cover success and failure outcome paths for a representative mutation
