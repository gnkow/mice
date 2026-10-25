import { kindOf } from './principal.js'
import type { PatRecord } from './credentialStore.js'

/** Avoid rewriting the store on every request. */
export const LAST_USED_DEBOUNCE_MS = 60_000

export type CredentialFacts = {
  nowMs: number
  /** Whether the Principal's cut-off covers a credential issued at `issuedAtSec`. */
  isRevoked(record: PatRecord, issuedAtSec: number): Promise<boolean>
  isServiceActive(id: string): Promise<boolean>
}

export type CredentialVerdict = 'ok' | 'expired' | 'service-inactive' | 'revoked'

export function isExpired(record: PatRecord, nowMs: number): boolean {
  return !!record.expiresAt && Date.parse(record.expiresAt) <= nowMs
}

/** Pure resolution policy: expiry, service-principal activity, revocation. */
export async function judgeCredential(record: PatRecord, facts: CredentialFacts): Promise<CredentialVerdict> {
  if (isExpired(record, facts.nowMs)) return 'expired'
  if (kindOf(record) === 'service' && !(await facts.isServiceActive(record.sub))) return 'service-inactive'
  if (await facts.isRevoked(record, Math.floor(Date.parse(record.createdAt) / 1000))) return 'revoked'
  return 'ok'
}

export function shouldRecordUse(record: PatRecord, nowMs: number): boolean {
  return !record.lastUsedAt || nowMs - Date.parse(record.lastUsedAt) >= LAST_USED_DEBOUNCE_MS
}
