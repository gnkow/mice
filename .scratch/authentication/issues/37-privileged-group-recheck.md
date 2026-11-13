Status: done

# 37: Re-check groups on privileged operations

**Spec:** `.specs/01-authentication.md` (U3, U18)

Split from issue 19. Per-request user-status checks stay in issue 19.

## Outcome

Every mutating repository or namespace authorization asks the directory for the caller's groups. The decision uses groups that are both on the Session and still listed. A group removed in the identity provider no longer satisfies pushes, merges, repository or namespace administration, collaborator management, jobs, workspace writes, or repository creation. A group added in the identity provider stays unused until a login stores it on the Session. Ordinary reads, including namespace view, keep the Session list. Namespace and repository grants are looked up for every authorization decision, so changing or removing a group grant takes effect on the next call. When a configured directory cannot answer, group-derived writes return 503. Signing has no group grant; a directory failure still returns 503 before the ceremony. The instance-admin allowlist is a Principal grant, so it does not change with the group list.

## Acceptance

- [x] Every write in a namespace or repository fetches groups from the directory and authorizes with that list
- [x] A group removed in the IdP cannot satisfy a sign, merge, or admin grant on the next such call
- [x] A group added in the IdP does not grant anything on an ordinary read
- [x] A directory failure on those actions returns 503
- [x] Namespace and repository group-grant changes take effect on the next authorization

## Code

- `auth/src/authentication/access/privilegedGroups.ts`
- `auth/src/authz.ts` (re-exports `confirmPrivilegedGroups`; callers use `withDirectoryGroups`)
- `auth/src/authentication/signing/signingRoutes.ts`
- `auth/src/authentication/directory/directoryKeycloak.ts`
- `auth/src/proxy.ts`

## Comments

- **Audit:** holds — privileged writes re-fetch directory groups and authorize with session∩directory; removed groups fail; added groups unused until login; directory failure → 503.
- **Deepen:** moved recheck into `authentication/access/privilegedGroups.ts` with pure `intersectSessionWithDirectoryGroups` plus `withDirectoryGroups` / `confirmPrivilegedGroups`; `authz` imports and re-exports.
- **Tests:** `privilegedGroups.unit.test.ts`, `privilegedGroups.test.ts`.
