# 15: Service principal PAT expiry notifications

**What to build:** The owner of a service principal is notified before one of its PATs expires, so CI does not fail unexpectedly. The notice goes through the notification system and names the principal and expiry date.

**Blocked by:** 13 (Service principals)

**Status:** done

- [x] The owner gets one notification at the configured lead time before expiry
- [x] The notification names the service principal and expiry date
- [x] No notification for already-expired or revoked PATs
- [x] Reassigning the owner redirects future notices to the new owner
- [x] Tested with a fake clock
