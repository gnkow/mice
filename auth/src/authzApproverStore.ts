import { APPROVER_ROLE } from './authzContract.js'
import { parseUserKey, userKey, type UserKey } from './authzTypes.js'
import * as authzRepo from './authzRepository.js'
import {
  requireIdBasedGroupBinding,
  toGroupBindingKey,
} from './groupBinding.js'
import {
  defaultGroupIssuer,
  getGroupDisplayNames,
  upsertGroupDisplayNames,
} from './groupDisplayStore.js'

export { APPROVER_ROLE }

/** Unit separator used in principal (user) storage keys — not in group binding keys. */
const USER_KEY_SEP = '\u001f'

export type ApproverDecision = {
  allow: boolean
  status: number
  reason: string
}

export type ApproverPrincipal =
  | { kind: 'user'; sub: string; iss: string }
  | { kind: 'group'; group: string; name?: string }

const ALLOWED: ApproverDecision = Object.freeze({ allow: true, status: 200, reason: 'ok' })

function denied(reason: string, status = 403): ApproverDecision {
  return { allow: false, status, reason }
}

export function isUserApproverStorageKey(key: string): boolean {
  return key.includes(USER_KEY_SEP)
}

export function approverStorageKey(target: ApproverPrincipal): string {
  return target.kind === 'group' ? target.group : userKey(target)
}

export function parseApproverStorageKey(key: string): ApproverPrincipal {
  if (isUserApproverStorageKey(key)) {
    const { sub, iss } = parseUserKey(key)
    return { kind: 'user', sub, iss }
  }
  return { kind: 'group', group: key }
}

async function withGroupNames(principals: ApproverPrincipal[]): Promise<ApproverPrincipal[]> {
  const groupKeys = principals.filter((p) => p.kind === 'group').map((p) => p.group)
  if (!groupKeys.length) return principals
  const names = await getGroupDisplayNames(groupKeys)
  return principals.map((p) => {
    if (p.kind !== 'group') return p
    const cached = names.get(p.group)
    return cached?.displayName ? { ...p, name: cached.displayName } : p
  })
}

export type GrantApproverResult = { ok: true } | { ok: false; error: string }

/** Untrusted HTTP body for grant/revoke approver seats. */
export type ApproverTargetBody = {
  kind?: 'user' | 'group'
  sub?: string
  iss?: string
  group?: string
  name?: string
}

/**
 * Parse and validate an approver principal from a route body.
 * Shared by grant and revoke so both routes cannot drift.
 */
export function parseApproverTargetFromBody(
  body: ApproverTargetBody,
): { ok: true; target: ApproverPrincipal } | { ok: false; error: string } {
  const kind = body.kind ?? (body.group && !body.sub ? 'group' : 'user')
  if (kind === 'group') {
    const group = (body.group ?? '').trim()
    if (!group) return { ok: false, error: 'group required' }
    const name = body.name?.trim()
    return {
      ok: true,
      target: name ? { kind: 'group', group, name } : { kind: 'group', group },
    }
  }
  const sub = (body.sub ?? '').trim()
  const iss = (body.iss ?? '').trim()
  if (!sub || !iss) return { ok: false, error: 'sub and iss required' }
  return { ok: true, target: { kind: 'user', sub, iss } }
}

/**
 * Grant or revoke an approver seat after the Owner gate has already passed.
 * Returns the updated list so routes stay thin adapters.
 */
export async function mutateApproverSeat(input: {
  op: 'grant' | 'revoke'
  scope: authzRepo.ApproverScope
  body: ApproverTargetBody
}): Promise<
  | { ok: true; approvers: ApproverPrincipal[] }
  | { ok: false; status: 400 | 404; error: string }
> {
  const parsed = parseApproverTargetFromBody(input.body)
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error }
  if (input.op === 'grant') {
    const granted = await grantApprover(input.scope, parsed.target)
    if (!granted.ok) {
      return {
        ok: false,
        status: granted.error === 'Not found' ? 404 : 400,
        error: granted.error,
      }
    }
  } else {
    await revokeApprover(input.scope, parsed.target)
  }
  return { ok: true, approvers: await listApprovers(input.scope) }
}

export async function grantApprover(
  scope: authzRepo.ApproverScope,
  target: ApproverPrincipal,
): Promise<GrantApproverResult> {
  if (target.kind === 'group') {
    const bound = requireIdBasedGroupBinding(defaultGroupIssuer(), target.group)
    if (!bound.ok) return { ok: false, error: bound.error }
    const displayName = (target.name ?? '').trim() || bound.groupId
    await upsertGroupDisplayNames([
      { bindingKey: bound.bindingKey, displayName, idBased: true },
    ])
    const ok = await authzRepo.addApprover(scope, bound.bindingKey)
    return ok ? { ok: true } : { ok: false, error: 'Not found' }
  }
  if (!target.sub?.trim() || !target.iss?.trim()) {
    return { ok: false, error: 'sub and iss required' }
  }
  const ok = await authzRepo.addApprover(scope, userKey(target))
  return ok ? { ok: true } : { ok: false, error: 'Not found' }
}

export async function revokeApprover(
  scope: authzRepo.ApproverScope,
  target: ApproverPrincipal,
): Promise<boolean> {
  if (target.kind === 'group') {
    const { bindingKey } = toGroupBindingKey(defaultGroupIssuer(), target.group)
    return authzRepo.removeApprover(scope, bindingKey)
  }
  return authzRepo.removeApprover(scope, userKey(target))
}

export async function listApprovers(
  scope: authzRepo.ApproverScope,
): Promise<ApproverPrincipal[]> {
  const keys = await authzRepo.listApproverKeys(scope)
  return withGroupNames(keys.map(parseApproverStorageKey))
}

/** Chronological approver-seat versions for a namespace or repository (entity history, not audit). */
export async function listApproverHistory(scope: authzRepo.ApproverScope) {
  const versions = await authzRepo.listApproverVersions(scope)
  if (!versions) return null
  const allKeys = [...new Set(versions.flatMap((v) => v.approvers))]
  const named = await withGroupNames(allKeys.map(parseApproverStorageKey))
  const byKey = new Map(named.map((p) => [approverStorageKey(p), p]))
  return versions.map((v) => ({
    ...v,
    approvers: v.approvers.map(
      (k) => byKey.get(k) ?? parseApproverStorageKey(k),
    ),
  }))
}

/**
 * True when the user holds an explicit approver seat directly or via an IdP group
 * that holds a seat (repository or namespace scope).
 */
export async function isApprover(
  ns: string,
  repo: string,
  user: UserKey & { groups?: string[] },
): Promise<boolean> {
  const keys = [userKey(user), ...(user.groups ?? [])]
  for (const key of keys) {
    if (await authzRepo.isApproverKey(ns, repo, key)) return true
  }
  return false
}

/**
 * "Approver for this repository": holds an explicit approver grant on the repository or its
 * namespace (user or group seat). `maintain`, Owner, admin and bootstrap grants never imply it.
 */
export async function decideIsApprover(
  user: UserKey & { groups?: string[] },
  ns: string,
  repo: string,
): Promise<ApproverDecision> {
  return (await isApprover(ns, repo, user)) ? ALLOWED : denied('Approver role required')
}
