Status: done

# 08: Human commit author

**Spec:** `.specs/01-authentication.md` (story 10, Q10, R2). Q10 and Q64 describe a commit-message trailer. This issue stores the Principal in the commit `author` field.

**Blocked by:** none

Job id and token hash on a job commit are `.scratch/jobs/issues/01-job-commit-attribution.md`. Job token lifetime and the commit hold are `.scratch/jobs/issues/02-job-token-lifetime-and-commit-hold.md`. Showing a newer email in commit views is issue 49.

## Outcome

A human commit written through the BFF has `author` set to the Principal's canonical `iss|sub` and `email` set to the Principal's email at commit time. A trailing slash on `iss` is removed. Client-supplied author and email fields are overwritten. The commit message is left as the client sent it. The audit actor for that commit stores the same canonical `iss`, `sub`, and email.

## Acceptance

- [x] A human commit's `author` is the Principal's canonical `iss|sub`
- [x] A human commit's `email` is the Principal's email at commit time
- [x] A client-supplied author or email is overwritten with those values
- [x] The commit message is left unchanged
- [x] The audit actor's `iss`, `sub`, and email match the commit

## Code

- `auth/src/authentication/author.ts` (`commitAuthor`)
- `auth/src/authentication/session/principal.ts` (`canonicalIssuer`)
- `auth/src/audit.ts` (`actorFromUser`)
- `auth/src/proxyAuthor.test.ts`
