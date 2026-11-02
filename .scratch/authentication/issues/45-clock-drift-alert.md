Status: done

# 45: Clock-drift alert

**Spec:** `.specs/01-authentication.md` (R5)

**Blocked by:** none

Split from issue 13. The validation pack document stays there.

## What to build

The BFF compares its clock with an NTP reference. Drift above 1 second raises an alert. Client timestamps are never used as the time of an authentication or signature event.

## In code today

`startClockDriftSchedule` queries NTP (or an injected reference) and alerts instance admins when `checkClockDrift` is outside 1 second. The alert summary includes the measured drift. Boot starts the schedule. Authentication events and signatures already stamp `Date.now()`; request bodies do not set those times.

## Acceptance

- [x] A scheduled check compares the server clock with an NTP reference
- [x] Drift greater than 1 second raises an alert that includes the measured drift
- [x] Drift of 1 second or less does not alert
- [x] Authentication and signature event times come from the server clock
