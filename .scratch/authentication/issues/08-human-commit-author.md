Status: done

# 08: Human commit author

**Spec:** `.specs/01-authentication.md` (story 10, Q10, R2). Q10 and Q64 describe a commit-message trailer. This issue stores the Principal in the commit `author` field.

**Blocked by:** none

Job id and token hash on a job commit are `.scratch/jobs/issues/01-job-commit-attribution.md`. Job token lifetime and the commit refusal are `.scratch/jobs/issues/02-job-token-lifetime-and-commit-refusal.md`. Showing a newer email in commit views is issue 49.

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
- `auth/src/authentication/commits/commitIdentity.ts` (`humanCommitAuthor`, `humanCommitEmail`)
- `auth/src/authentication/session/principal.ts` (`canonicalIssuer`)
- `auth/src/audit.ts` (`actorFromUser`)
- `auth/src/proxyAuthor.test.ts`
- `auth/src/authentication/author.test.ts`
- `auth/src/authentication/commits/commitIdentity.test.ts`

## Comments

2026-11-13 — Checkmate audit: **holds** (acceptance covered by `proxyAuthor.test.ts` + author/commitIdentity unit tests).

**Deepen (auto-picked):** Own human commit `author`/`email` identity in `commitIdentity` (`humanCommitAuthor` / `humanCommitEmail`); `author.ts` `commitAuthor` + inject paths and `formatIdentityTrailer` call that seam. No session.ts rewrite.

**Files:** `commitIdentity.ts`, `author.ts`, `author.test.ts`, `commitIdentity.test.ts`

**deep-api Deepen** (auto-pick Top): Added `humanCommitFields` (`{ author, email }`) as the deep stamp seam; `commitAuthor` + `injectAuthorJson` / `injectAuthorFormData` / nested overwrite all go through it once. Unit: `commitIdentity.test.ts` + `author.test.ts`. (Pre-existing `proxyAuthor.test.ts` bodyless-write 400s unrelated to this deepen.)
