export { captureBefore, pickSnapshot } from './auditCapture.js'
import { toGroupBindingKey } from '../../authz/types.js'
import { defaultGroupIssuer } from '../../authz/types.js'

export type PrincipalTargetBody = {
  kind?: 'user' | 'group'
  sub?: string
  iss?: string
  group?: string
}

type RolePrincipal =
  | { kind: 'user'; sub: string; iss: string; role: string }
  | { kind: 'group'; group: string; role: string }

/** The role a user/group target holds in a principal list, or null when it holds none. */
export function principalRole(
  principals: readonly RolePrincipal[],
  body: PrincipalTargetBody,
): string | null {
  const kind = body.kind ?? (body.group && !body.sub ? 'group' : 'user')
  if (kind === 'group') {
    if (!body.group?.trim()) return null
    const key = toGroupBindingKey(defaultGroupIssuer(), body.group).bindingKey
    const hit = principals.find((p) => p.kind === 'group' && (p.group === key || p.group === body.group))
    return hit ? String(hit.role) : null
  }
  const hit = principals.find((p) => p.kind === 'user' && p.sub === body.sub && p.iss === body.iss)
  return hit ? String(hit.role) : null
}

/** Whether a user/group target holds a seat (approver-style lists without a role). */
export function principalSeat(
  principals: ReadonlyArray<{ kind: 'user'; sub: string; iss: string } | { kind: 'group'; group: string }>,
  body: PrincipalTargetBody,
): boolean {
  return (
    principalRole(
      principals.map((p) => ({ ...p, role: 'seat' })) as RolePrincipal[],
      body,
    ) !== null
  )
}
