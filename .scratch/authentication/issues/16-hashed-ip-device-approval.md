Status: done

# 16: Hashed IP primitive and device-approval display

**Spec:** `.specs/01-authentication.md` (U8, device-approval half)

Putting the hash on every authentication audit event is issue 44.

## Outcome

A daily salt is stored and rotated at midnight UTC. `hashIp` computes SHA-256 of the IP plus that salt. Device authorization stores `request_hashed_ip`. Device approval stores the approver hash. The approval page shows the last 4 hex characters. The same IP hashes to the same value within a day and to a different value after the salt rotates.

## Acceptance

- [x] The daily salt is generated once per UTC day and reused until the next day
- [x] The hash is SHA-256(IP + daily salt)
- [x] Device approval persists and displays the last 4 hex characters
- [x] The same IP produces a different hash after the salt rotates

## Code

- `auth/src/ipHash.ts`
- `auth/src/db/schema.ts` (`deviceAuthorizations.requestHashedIp`, `deviceApprovals`)
- `web/src/pages/CliDevicePage.tsx`
