Status: done

# 49: Current email on commit views

**Spec:** `.specs/01-authentication.md` (story 10, Q10)

**Blocked by:** 08

The commit stores the email at submission. This issue is the later display of a changed email.

## Outcome

Login stores one current email on the Principal. A later login with a different email replaces it. Commit views resolve `author` (`iss|sub`) through `POST /auth/principals/emails`. The view shows the email stored on the commit, and the Principal's current email when that differs. An unknown author shows the email stored on the commit. The oxen commit is not rewritten.

## Acceptance

- [x] Login updates the Principal's current email when the IdP email changes
- [x] A repeated login with the same email does not add a second current email
- [x] A commit view shows the email stored on the commit when it matches the Principal's current email
- [x] When the current email differs, the commit view shows the current email
- [x] The oxen commit's `email` stays the submission-time value
- [x] An unresolved author shows the email stored on the commit

## Code

- `auth/src/authentication/session/session.ts` (`ensurePrincipal`, `getCurrentEmail`, `currentEmailsByAuthor`)
- `auth/src/authentication/session/meRoutes.ts`
- `auth/src/authentication/session/emailLookupRequest.ts` (`parseEmailLookupAuthors`)
- `auth/drizzle/0003_principal_email.sql`
- `web/src/lib/commitEmail.ts`
- `web/src/components/CommitEmail.tsx`

## Comments

- **Audit:** holds — login email replace-once; `POST /auth/principals/emails`; commit views prefer current when it differs, else stored; oxen email unchanged.
- **Deepen (auto-pick):** Own display decision in `decideCommitEmailDisplay` (`web/src/lib/commitEmail.ts`); `CommitEmail` renders through that seam. meRoutes carefully: extract `parseEmailLookupAuthors` only — no `session.ts` / `ensurePrincipal` rewrite.
- **Tests:** `web/src/lib/commitEmail.test.ts`, `auth/src/authentication/session/emailLookupRequest.test.ts` (session email still covered by `principalEmail.test.ts`)
