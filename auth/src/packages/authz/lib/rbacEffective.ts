import { isInstancePermission, type InstancePermission } from './rbacCatalog.js'
import { getRolePermissions, type InstanceRole } from './rbacRoles.js'

/** Merge role defaults with custom grants; order is role perms then new customs; deduped. */
export function mergeEffectivePermissions(
  role: InstanceRole | null,
  custom: readonly string[],
): InstancePermission[] {
  const out: InstancePermission[] = role ? getRolePermissions(role) : []
  const seen = new Set<string>(out)
  for (const p of custom) {
    if (!isInstancePermission(p) || seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}
