/** Only the namespace Owner may delete it; instance admins hold no data access. */
export function canDeleteNamespace(authz: { role: string | null } | null | undefined): boolean {
  return authz?.role === 'owner'
}

/** Empty-list copy for /namespaces; Admin SoD gets an explicit no-data-access message. */
export function namespacesEmptyMessage(input: {
  filter: string
  canCreate: boolean
  isInstanceAdmin: boolean
}): string {
  const q = input.filter.trim()
  if (q) return `No namespaces match “${q}”.`
  if (input.isInstanceAdmin) {
    return 'No namespaces in your catalog. Instance admins manage the platform and are not granted data-plane membership (separation of duties).'
  }
  if (input.canCreate) {
    return 'No namespaces yet. Create a namespace to set access before adding repositories.'
  }
  return 'No namespaces yet. Ask an admin for access, or create a repository if you have permission.'
}
