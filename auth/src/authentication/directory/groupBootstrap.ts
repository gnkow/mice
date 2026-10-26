import { env } from '../../env.js'
import { matchesIdentityEntry } from '../session/principal.js'
import type { SessionUser } from '../session/session.js'
import { writeInstancePermissions } from '../../authzInstanceStore.js'
import { setNamespaceMember } from '../../authzMembershipStore.js'
import { createNamespaceAuthz, getNamespace } from '../../authzNamespaceStore.js'
import type { InstancePermission, NamespaceRole } from '../../authzTypes.js'

/**
 * AUTHZ_GROUP_BOOTSTRAP JSON map:
 * {
 *   "devs": {
 *     "instancePermissions": [
 *       "create_namespace", "view_audit", "view_lineage",
 *       "manage_own_tokens", "cli_device_approve",
 *       "session_create", "session_connect"
 *     ]
 *   },
 *   "team-x": { "namespace": "team-x", "role": "member", "createNamespace": true, "basePermission": "read" }
 * }
 * Applied when session.groups includes the key, or the key is `<iss>|<sub>` or a verified email
 * of the Principal.
 * Under AUTHZ_ENFORCE, sessions/PATs/CLI device require explicit instance perms.
 */
type BootstrapEntry = {
  instancePermissions?: InstancePermission[]
  namespace?: string
  role?: NamespaceRole
  createNamespace?: boolean
  basePermission?: 'none' | 'read' | 'triage' | 'write' | 'maintain' | 'admin'
}

function parseMap(): Record<string, BootstrapEntry> {
  const raw = env.authzGroupBootstrap.trim()
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, BootstrapEntry>
  } catch {
    console.error('[mice-auth] invalid AUTHZ_GROUP_BOOTSTRAP JSON')
    return {}
  }
}

export async function applyGroupBootstrap(
  user: SessionUser & { groups?: string[] },
): Promise<void> {
  const map = parseMap()
  if (!Object.keys(map).length) return
  const groups = new Set((user.groups ?? []).map((g) => g.toLowerCase()))
  for (const [key, entry] of Object.entries(map)) {
    if (!groups.has(key.toLowerCase()) && !matchesIdentityEntry(key, user)) continue
    if (entry.instancePermissions?.length) {
      await writeInstancePermissions(user, entry.instancePermissions)
    }
    if (entry.namespace && entry.role) {
      if (entry.createNamespace && !await getNamespace(entry.namespace)) {
        await createNamespaceAuthz(
          user,
          entry.namespace,
          entry.basePermission ?? 'none',
          true,
        )
      } else if (await getNamespace(entry.namespace)) {
        await setNamespaceMember(entry.namespace, user, entry.role)
      }
    }
  }
}
