/** Roles a signed-in user may request as an upgrade (Admin/Auditor are grant-only). */
const UPGRADE_LADDER = ['external', 'user', 'manager'] as const

export type UpgradeableRoleId = (typeof UPGRADE_LADDER)[number]

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  user: 'User',
  auditor: 'Auditor',
  external: 'External User',
}

/** Display label for the profile role badge. */
export function profileRoleBadge(input: {
  role: string | null
  pending: boolean
}): string {
  if (input.pending || input.role == null) return 'Pending'
  return ROLE_LABEL[input.role] ?? input.role
}

/** Formal roles above the caller's current role that they may request. */
export function upgradeableRoles(role: string | null): UpgradeableRoleId[] {
  if (role == null) return [...UPGRADE_LADDER]
  const idx = (UPGRADE_LADDER as readonly string[]).indexOf(role)
  if (idx === -1) return []
  return UPGRADE_LADDER.slice(idx + 1)
}
