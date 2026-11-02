Status: done

# 22: Name change history

**Spec:** `.specs/01-authentication.md` (U11, storage half)

Showing the current name next to the name at signing, and an admin timeline, is issue 47.

## Outcome

`principal_name_history` stores each name with `valid_from` and `valid_to`. `ensurePrincipal` calls `trackNameChange` on login. A changed name closes the previous row and opens a new one. An unchanged name does not insert a duplicate. Signature records keep `session.name`, which is the name at signing time. `getNameAtTime` and `getNameHistory` read the timeline.

## Acceptance

- [x] The history table records name, valid from, and valid to
- [x] Login opens a new history row when the IdP name changes and closes the previous row
- [x] A repeated login with the same name does not insert a duplicate row
- [x] The signature record keeps the name from the session at signing time

## Code

- `auth/src/authentication/session/nameChangeHistory.ts`
- `auth/src/authentication/session/session.ts` (`ensurePrincipal`)
- `auth/src/db/schema.ts` (`principalNameHistory`)
