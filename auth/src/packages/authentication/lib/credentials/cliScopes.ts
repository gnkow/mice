/**
 * Scope parsing for CLI device flow tokens.
 * 
 * Note: PATs were removed per spec, but device flow tokens still use scopes
 * to restrict access to specific namespaces/repos.
 */

import type { CliCredentialScope } from '../session/session.js'

const ROLES = ['read', 'triage', 'write', 'maintain', 'admin'] as const
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const MAX_SCOPES = 20

export type ParsedScopes =
  | { ok: true; scopes: CliCredentialScope[] | undefined }
  | { ok: false; error: string }

/** Validates scopes supplied when minting a device flow token. Empty means unscoped. */
export function parseCliScopes(raw: unknown): ParsedScopes {
  if (raw === undefined || raw === null) return { ok: true, scopes: undefined }
  if (!Array.isArray(raw)) return { ok: false, error: 'scopes must be an array' }
  if (raw.length === 0) return { ok: true, scopes: undefined }
  if (raw.length > MAX_SCOPES) return { ok: false, error: `At most ${MAX_SCOPES} scopes` }
  const scopes: CliCredentialScope[] = []
  for (const item of raw as Array<Record<string, unknown>>) {
    const namespace = item?.namespace
    const repo = item?.repo
    const maxRole = item?.maxRole
    if (typeof namespace !== 'string' || !NAME.test(namespace)) {
      return { ok: false, error: 'Invalid scope namespace' }
    }
    if (repo !== undefined && (typeof repo !== 'string' || !NAME.test(repo))) {
      return { ok: false, error: 'Invalid scope repo' }
    }
    if (!ROLES.includes(maxRole as (typeof ROLES)[number])) {
      return { ok: false, error: `Scope role must be one of ${ROLES.join(', ')}` }
    }
    scopes.push({
      namespace,
      ...(repo ? { repo: repo as string } : {}),
      maxRole: maxRole as CliCredentialScope['maxRole'],
    })
  }
  return { ok: true, scopes }
}
