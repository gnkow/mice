import type { BasePermission } from './authzTypes.js'

/** Seat that may be kept or dropped when a repository changes namespace. */
export type TransferAccessSeat =
  | { kind: 'user'; key: string; role?: string; seat: 'collaborator' | 'approver' }
  | { kind: 'group'; key: string; role?: string; seat: 'collaborator' | 'approver' }

export type TransferAccessDiff = {
  kept: TransferAccessSeat[]
  dropped: TransferAccessSeat[]
  /** Dest members who would gain access via namespace base permission (warning only). */
  newlyInheriting: Array<{ kind: 'user' | 'group'; key: string; viaBasePermission: BasePermission }>
}

function seatKey(s: { kind: string; key: string; seat: string }): string {
  return `${s.seat}:${s.kind}:${s.key}`
}

/**
 * Keep repo collaborators and repo-scoped approvers who already hold a dest namespace
 * membership seat (user or group). Base permission alone does not count as membership.
 * Group seats are kept iff the group itself is a dest member (no expansion to individuals).
 */
export function partitionTransferAccess(input: {
  collaborators: Array<{ kind: 'user' | 'group'; key: string; role: string }>
  approvers: Array<{ kind: 'user' | 'group'; key: string }>
  destMemberUserKeys: ReadonlySet<string>
  destMemberGroupKeys: ReadonlySet<string>
  destBasePermission: BasePermission
  destMembers: Array<{ kind: 'user' | 'group'; key: string }>
}): TransferAccessDiff {
  const isMember = (kind: 'user' | 'group', key: string) =>
    kind === 'user' ? input.destMemberUserKeys.has(key) : input.destMemberGroupKeys.has(key)

  const kept: TransferAccessSeat[] = []
  const dropped: TransferAccessSeat[] = []

  for (const c of input.collaborators) {
    const seat: TransferAccessSeat = {
      kind: c.kind,
      key: c.key,
      role: c.role,
      seat: 'collaborator',
    }
    if (isMember(c.kind, c.key)) kept.push(seat)
    else dropped.push(seat)
  }

  for (const a of input.approvers) {
    const seat: TransferAccessSeat = { kind: a.kind, key: a.key, seat: 'approver' }
    if (isMember(a.kind, a.key)) kept.push(seat)
    else dropped.push(seat)
  }

  const keptCollabKeys = new Set(
    kept.filter((s) => s.seat === 'collaborator').map((s) => `${s.kind}:${s.key}`),
  )

  const newlyInheriting: TransferAccessDiff['newlyInheriting'] = []
  if (input.destBasePermission !== 'none') {
    for (const m of input.destMembers) {
      if (keptCollabKeys.has(`${m.kind}:${m.key}`)) continue
      newlyInheriting.push({
        kind: m.kind,
        key: m.key,
        viaBasePermission: input.destBasePermission,
      })
    }
  }

  kept.sort((a, b) => seatKey(a).localeCompare(seatKey(b)))
  dropped.sort((a, b) => seatKey(a).localeCompare(seatKey(b)))
  newlyInheriting.sort((a, b) => `${a.kind}:${a.key}`.localeCompare(`${b.kind}:${b.key}`))

  return { kept, dropped, newlyInheriting }
}
