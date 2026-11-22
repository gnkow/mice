/**
 * Identity bootstrap at authenticate/login (authorization #11).
 *
 * Only `AUTHZ_BOOTSTRAP_ADMINS` may receive an automatic Admin role.
 * IdP groups never autoprovision instance permissions or namespace membership —
 * `AUTHZ_GROUP_BOOTSTRAP` and `applyGroupBootstrap` are gone. A namespace or
 * repository group grant still applies at decision time after an administrator
 * records that group.
 */
import type { SessionUser } from './authentication/index.js'
import { matchesBootstrap } from './authzRepository.js'
import { maybeBootstrapInstanceAdmin } from './authzInstanceStore.js'

/** Pure policy: whether this Principal may receive Admin from the allowlist. */
export type PrincipalBootstrapDecision =
  | { action: 'grant_admin' }
  | { action: 'none'; reason: 'not_on_allowlist' }

/**
 * Allowlist-only bootstrap decision. IdP `groups` never influence the outcome.
 */
export function decidePrincipalBootstrap(user: SessionUser): PrincipalBootstrapDecision {
  if (matchesBootstrap(user)) return { action: 'grant_admin' }
  return { action: 'none', reason: 'not_on_allowlist' }
}

/**
 * Run allowlist-only bootstrap. Returns whether the Principal is (now) an Admin.
 * Groups on the session are ignored — only `AUTHZ_BOOTSTRAP_ADMINS` can grant.
 */
export async function runPrincipalBootstrap(user: SessionUser): Promise<boolean> {
  if (decidePrincipalBootstrap(user).action !== 'grant_admin') return false
  return maybeBootstrapInstanceAdmin(user)
}
