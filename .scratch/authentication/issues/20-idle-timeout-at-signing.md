# 20: Idle Timeout Enforcement at Signing (U2)

**What to build:** Refuse signing if the user's last authenticated request was more than 15 minutes ago. Enforce 15-minute idle timeout (revert Round 4's R9 which changed it to 30 minutes).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] SessionUser.lastActive timestamp tracked on every authenticated request (already exists, updated by touchSession)
- [ ] Signing ceremony checks: refuse if (now - lastActive) > 15 minutes
- [ ] Configuration: env.sessionIdleSec = 900 (15 minutes, not 1800)
- [ ] Error message for idle timeout at signing: "Session idle for 15+ minutes, re-authenticate required"
- [ ] Step-up flow resets lastActive (user performed authentication action)
- [ ] Tests for idle timeout at signing (14 min: allowed, 16 min: refused), activity refresh, step-up reset

## Context

Round 8 decision U2 reverts R9's 30-minute idle timeout back to the original 15 minutes. FDA and typical lab SOPs expect shorter idle timeouts for GxP systems. Part 11 and cleanroom workstation SOPs typically specify 10-15 minutes.

"Idle" is defined as "no authenticated HTTP requests within the 15-minute window" (not tab-focus or mouse movement).
