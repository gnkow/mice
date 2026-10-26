# 04: Live IdP check and access states

**What to build:** Access always reflects the IdP. The IdP/directory is checked at login, refresh, signing and privileged mutations, and for ordinary requests at most every 5 minutes; if the check cannot run, access is denied (no cache). IdP status and Mice flags are independent. Auto-provisioned Principals get zero rights.

**Blocked by:** 02 (web login tracer)

**Status:** ready-for-agent

- [ ] IdP unreachable blocks login and expires access beyond the 5-minute bound
- [ ] IdP-disabled Principal loses access immediately at the next check
- [ ] Re-enable restores access automatically if disabled 30 days or less and no Mice flag is set; longer needs admin re-confirmation; every restore is audited
- [ ] Mice flags need an explicit lift; grants are kept (suspended), not deleted
- [ ] Auto-provisioning and bootstrap rules grant read-only baseline at most (rules apply to everyone)
- [ ] iss+sub is never reused: reissue to another person refuses login and raises an incident; rehire logic follows spec S8
- [ ] Group matching uses object ids
