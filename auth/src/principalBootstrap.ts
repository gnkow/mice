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
import { maybeBootstrapInstanceAdmin } from './authzInstanceStore.js'

/** Run allowlist-only bootstrap. Returns whether the Principal is (now) an Admin. */
export async function runPrincipalBootstrap(user: SessionUser): Promise<boolean> {
  return maybeBootstrapInstanceAdmin(user)
}
