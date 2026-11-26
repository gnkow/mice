import { matchesIdentityEntry } from '../../authentication/principal.js'
import type { SessionUser } from '../../authentication/principal.js'
import { env } from '../../shared/index.js'
import { TransactionRollbackError } from 'drizzle-orm/errors'
import { toGroupBindingKey } from './groupBinding.js'
import { defaultGroupIssuer } from './groupIssuer.js'

export type AuthzRepoResult = { ok: true } | { ok: false; error: string }

export function sessionGroups(user: { groups?: string[]; iss?: string }): string[] {
  const iss = user.iss?.trim() ? user.iss : defaultGroupIssuer()
  const out: string[] = []
  const seen = new Set<string>()
  for (const g of user.groups ?? []) {
    if (!g?.trim()) continue
    const resolved = toGroupBindingKey(iss, g)
    if (!resolved.idBased) continue
    if (seen.has(resolved.bindingKey)) continue
    seen.add(resolved.bindingKey)
    out.push(resolved.bindingKey)
  }
  return out
}

export function repoKey(ns: string, repo: string): string {
  return `${ns}/${repo}`
}

export function bootstrapAllowlist(): string[] {
  return env.authzBootstrapAdmins
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function matchesBootstrap(user: SessionUser): boolean {
  return bootstrapAllowlist().some((entry) => matchesIdentityEntry(entry, user))
}

export function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })
  return code?.code === '23505' || code?.cause?.code === '23505'
}

/** `tx.rollback()` throws a TransactionRollbackError; turn it into the intended refusal. */
export function rollbackAs(e: unknown, error: string): AuthzRepoResult {
  if (e instanceof TransactionRollbackError) return { ok: false, error }
  throw e
}
