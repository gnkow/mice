import { env } from './env.js'
import type { SessionUser } from './session.js'
import {
  createNamespaceAuthz,
  getNamespace,
  setNamespaceMember,
  writeInstancePermissions,
} from './authzStore.js'
import type { InstancePermission, NamespaceRole } from './authzTypes.js'

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
 * Applied when session.groups includes the key (or email matches key).
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

export function applyGroupBootstrap(
  user: SessionUser & { groups?: string[] },
): void {
  const map = parseMap()
  if (!Object.keys(map).length) return
  const keys = new Set<string>([
    ...(user.groups ?? []).map((g) => g.toLowerCase()),
    user.email.toLowerCase(),
  ])
  for (const [key, entry] of Object.entries(map)) {
    if (!keys.has(key.toLowerCase())) continue
    if (entry.instancePermissions?.length) {
      writeInstancePermissions(user, entry.instancePermissions)
    }
    if (entry.namespace && entry.role) {
      if (entry.createNamespace && !getNamespace(entry.namespace)) {
        createNamespaceAuthz(
          user,
          entry.namespace,
          entry.basePermission ?? 'none',
          true,
        )
      } else if (getNamespace(entry.namespace)) {
        setNamespaceMember(entry.namespace, user, entry.role)
      }
    }
  }
}
