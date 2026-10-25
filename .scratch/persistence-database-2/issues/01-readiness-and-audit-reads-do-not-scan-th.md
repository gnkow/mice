# 01: Readiness and audit reads do not scan the log

**What to build:** /readyz and the audit store check answer from the newest row, not by reading every audit row, so health checks stay cheap as the trail grows.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] Readiness reports store ok without reading all rows
- [ ] A broken store still reports error
- [ ] Existing readiness tests stay green
