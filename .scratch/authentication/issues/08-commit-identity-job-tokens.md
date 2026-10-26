# 08: Commit identity and Job tokens

**What to build:** Every commit and automated action is attributable to a person. The BFF strips any client-supplied identity trailers and appends iss+sub and a name snapshot. Jobs get BFF-internal tokens; actions are attributed to the submitter with a "performed by Job" marker; only humans sign.

**Blocked by:** 04 (live IdP check and access states), 05 (authentication event audit and failure alerts)

**Status:** ready-for-agent

- [ ] Client-forged trailers are stripped; the appended trailer matches the audit record
- [ ] Name snapshot and name history keep the name as of the commit
- [ ] Job token lifetime equals the Job's maximum runtime; at commit the submitter is re-checked against the IdP
- [ ] IdP down at commit holds the commit in the finalizing state until it returns or retention ends; never auto-approved
- [ ] Jobs can never give a signature meaning
