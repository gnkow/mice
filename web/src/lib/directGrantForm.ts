export type DirectGrantFormState = {
  sub: string
  iss: string
  role: string | null
  permissions: string[]
  expiresAt: number
}

export type DirectGrantBody =
  | {
      kind: 'role'
      body: {
        sub: string
        iss: string
        role: string
        expiresAt: number
      }
    }
  | {
      kind: 'permissions'
      body: {
        sub: string
        iss: string
        permissions: string[]
        expiresAt: number
      }
    }

export type DirectGrantResult =
  | { ok: true; bodies: DirectGrantBody[] }
  | { ok: false; error: string }

/**
 * Validate Grant Access form → one or both POST /auth/grants/* bodies.
 * Reason belongs to the signing ceremony (`X-Mice-Reason`), not this form.
 */
export function buildDirectGrantBodies(state: DirectGrantFormState): DirectGrantResult {
  const sub = state.sub.trim()
  const iss = state.iss.trim()
  if (!sub || !iss) {
    return { ok: false, error: 'Choose a user (sub and iss required)' }
  }
  if (!Number.isFinite(state.expiresAt) || state.expiresAt <= 0) {
    return { ok: false, error: 'Expiry is required' }
  }
  const permissions = [...new Set(state.permissions.filter(Boolean))]
  if (state.role == null && permissions.length === 0) {
    return { ok: false, error: 'Choose a role or at least one permission' }
  }

  const bodies: DirectGrantBody[] = []
  if (state.role != null) {
    bodies.push({
      kind: 'role',
      body: { sub, iss, role: state.role, expiresAt: state.expiresAt },
    })
  }
  if (permissions.length > 0) {
    bodies.push({
      kind: 'permissions',
      body: { sub, iss, permissions, expiresAt: state.expiresAt },
    })
  }
  return { ok: true, bodies }
}
