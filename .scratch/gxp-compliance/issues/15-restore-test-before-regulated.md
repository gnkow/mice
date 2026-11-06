# 15: Restore test before first regulated action

**What to build:** A restore test must pass before the first regulated action (first validated-branch merge or signature). Until then those actions are refused.

**Blocked by:** 14, 05

**Status:** ready-for-agent

- [ ] First validated-branch merge or signature is refused until a restore test has passed
- [ ] Passing restore test is recorded and visible to operators
- [ ] Subsequent regulated actions proceed once the gate has passed
