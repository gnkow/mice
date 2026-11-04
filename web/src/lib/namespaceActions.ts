/** Only the namespace Owner may delete it; instance admins hold no data access. */
export function canDeleteNamespace(authz: { role: string | null } | null | undefined): boolean {
  return authz?.role === 'owner'
}
