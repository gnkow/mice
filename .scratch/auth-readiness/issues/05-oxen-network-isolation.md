# 05: Oxen reachable only from the BFF

**What to build:** The base compose file publishes no oxen-server port. A dev-only override publishes it for e2e helpers. In production the BFF refuses to start when the oxen upstream is a published or public address.

**Blocked by:** 01 (production startup gate)

**Status:** done

- [x] Base compose has no host port for oxen-server; the BFF still reaches it
- [x] Dev override restores the published port; e2e helpers use it
- [x] Production start fails for an upstream that is not an internal address, with a clear message
- [x] README deployment notes updated
