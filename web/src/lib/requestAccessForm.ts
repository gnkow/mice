/** Roles a no-access user may request (Admin/Auditor are grant-only). */
export const REQUESTABLE_ROLES = [
  {
    id: 'external' as const,
    label: 'External User',
    description: 'Read data and use sessions you are invited to.',
  },
  {
    id: 'user' as const,
    label: 'User',
    description: 'Read and write in repositories where you are a collaborator.',
  },
  {
    id: 'manager' as const,
    label: 'Manager',
    description: 'User access plus reviewing access requests up to Manager.',
  },
] as const

/** Shown under the formal-role picker — Admin/Auditor stay out of self-serve. */
export const REQUESTABLE_ROLES_FOOTNOTE =
  'Admin (platform only, no data/audit) and Auditor (MFA, time-boxed read) are assigned by an admin — they are not self-service.'

export type RequestableRoleId = (typeof REQUESTABLE_ROLES)[number]['id']

export type RequestAccessFormState = {
  mode: 'role' | 'custom'
  role: RequestableRoleId
  permissions: string[]
  message: string
}

export type AccessRequestPayload = {
  message: string
  requestedRole?: RequestableRoleId
  requestedPermissions?: string[]
}

export type BuildResult =
  | { ok: true; payload: AccessRequestPayload }
  | { ok: false; error: string }

/** Validate the Request Access form and produce the API body. */
export function buildAccessRequestPayload(state: RequestAccessFormState): BuildResult {
  const message = state.message.trim()
  if (!message) {
    return { ok: false, error: 'Justification is required' }
  }
  if (state.mode === 'role') {
    return {
      ok: true,
      payload: { message, requestedRole: state.role },
    }
  }
  const permissions = [...new Set(state.permissions.filter(Boolean))]
  if (permissions.length === 0) {
    return { ok: false, error: 'Select at least one permission' }
  }
  return {
    ok: true,
    payload: { message, requestedPermissions: permissions },
  }
}

export function togglePermission(selected: string[], permission: string): string[] {
  return selected.includes(permission)
    ? selected.filter((p) => p !== permission)
    : [...selected, permission]
}
