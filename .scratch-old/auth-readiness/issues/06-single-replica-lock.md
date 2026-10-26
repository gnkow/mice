# 06: Single-replica lock on the data directory

**What to build:** A second BFF process refuses to start against the same data directory, protecting single-writer JSON stores. A stale lock from a crashed process does not block restart.

**Blocked by:** 01 (production startup gate)

**Status:** done

- [x] Second instance fails with a clear message
- [x] Lock released on clean shutdown
- [x] Stale lock (dead process) is recovered
- [x] Tests cover all three
