/** Group `resource:…:op` permissions by the first segment. */
export function permissionResource(permission: string): string {
  const i = permission.indexOf(':')
  return i === -1 ? permission : permission.slice(0, i)
}

const RESOURCE_LABELS: Record<string, string> = {
  repo: 'Repository',
  namespace: 'Namespace',
  session: 'Session',
  workspace: 'Workspace',
  checkout: 'Checkout',
  job: 'Job',
  audit: 'Audit',
  access_request: 'Access request',
  cli_device: 'CLI device',
  instance: 'Instance',
}

/** Title-case a catalog segment for display (`custom_roles` → `Custom roles`). */
export function humanizePermissionSegment(segment: string): string {
  if (RESOURCE_LABELS[segment]) return RESOURCE_LABELS[segment]
  return segment
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/** Friendly label for a permission id; keep the raw id for copy/search. */
export function formatPermissionLabel(permission: string): {
  title: string
  detail: string
} {
  const parts = permission.split(':').filter(Boolean)
  if (parts.length === 0) return { title: permission, detail: permission }
  if (parts.length === 1) {
    return { title: humanizePermissionSegment(parts[0]), detail: permission }
  }
  const title = parts
    .slice(1)
    .map(humanizePermissionSegment)
    .join(' · ')
  return { title, detail: permission }
}

export type PermissionGroup = {
  resource: string
  label: string
  permissions: string[]
}

/** Stable groups ordered by first appearance in the catalog. */
export function groupPermissions(
  permissions: string[],
  query = '',
): PermissionGroup[] {
  const q = query.trim().toLowerCase()
  const filtered = q
    ? permissions.filter((p) => p.toLowerCase().includes(q))
    : permissions

  const order: string[] = []
  const byResource = new Map<string, string[]>()
  for (const perm of filtered) {
    const resource = permissionResource(perm)
    if (!byResource.has(resource)) {
      byResource.set(resource, [])
      order.push(resource)
    }
    byResource.get(resource)!.push(perm)
  }
  return order.map((resource) => ({
    resource,
    label: humanizePermissionSegment(resource),
    permissions: byResource.get(resource)!,
  }))
}
