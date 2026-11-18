import { desc } from 'drizzle-orm'
import { getDb } from '../../db/database.js'
import { idpBaselineChecks } from '../../db/schema.js'
import { decodeJwtPayload } from '../oidc/oidcClaims.js'
import {
  evaluateIdpMfaBaseline,
  type IdpBaselineClaimsFound,
  type IdpMfaBaselineEvaluation,
} from '../signing/mfaEvidence.js'

/**
 * IdP MFA baseline check (Ticket 14).
 *
 * One deep module: decode Session id_token claims, evaluate MFA evidence,
 * persist the storeable result, and project admin read views. Routes stay
 * HTTP/audit adapters.
 */

export type IdpBaselineCheckRow = {
  id: number
  checkedAt: Date
  checkedBy: string
  mfaAvailable: boolean
  claimsFound: IdpBaselineClaimsFound | null
  error: string | null
}

/** Admin JSON shape shared by POST check, GET status, and GET history. */
export type IdpBaselineCheckAdminView = {
  id: number
  checkedAt: Date
  checkedBy: string
  mfaAvailable: boolean
  claimsFound: IdpBaselineClaimsFound | null
  error: string | null
}

export type IdpBaselineCheckInput = {
  idToken?: string
  checkedBy: string
}

export type IdpBaselineCheckDeps = {
  decodeClaims?: (idToken: string) => Record<string, unknown>
  evaluate?: (payload: Record<string, unknown> | null) => IdpMfaBaselineEvaluation
  store?: (row: {
    checkedBy: string
    mfaAvailable: boolean
    claimsFound: IdpBaselineClaimsFound | null
    error: string | null
  }) => Promise<IdpBaselineCheckRow>
}

export type IdpBaselineCheckReadDeps = {
  findLatest?: () => Promise<IdpBaselineCheckRow | null>
  findRecent?: (limit: number) => Promise<IdpBaselineCheckRow[]>
}

function defaultDecode(idToken: string): Record<string, unknown> {
  return decodeJwtPayload(idToken)
}

function rowFromDb(check: {
  id: number
  checkedAt: Date
  checkedBy: string
  mfaAvailable: boolean
  claimsFound: unknown
  error: string | null
}): IdpBaselineCheckRow {
  return {
    id: check.id,
    checkedAt: check.checkedAt,
    checkedBy: check.checkedBy,
    mfaAvailable: check.mfaAvailable,
    claimsFound: check.claimsFound as IdpBaselineClaimsFound | null,
    error: check.error,
  }
}

async function defaultStore(row: {
  checkedBy: string
  mfaAvailable: boolean
  claimsFound: IdpBaselineClaimsFound | null
  error: string | null
}): Promise<IdpBaselineCheckRow> {
  const [check] = await getDb()
    .insert(idpBaselineChecks)
    .values({
      checkedBy: row.checkedBy,
      mfaAvailable: row.mfaAvailable,
      claimsFound: row.claimsFound,
      error: row.error,
    })
    .returning()
  return rowFromDb(check)
}

async function defaultFindLatest(): Promise<IdpBaselineCheckRow | null> {
  const [check] = await getDb()
    .select()
    .from(idpBaselineChecks)
    .orderBy(desc(idpBaselineChecks.checkedAt))
    .limit(1)
  return check ? rowFromDb(check) : null
}

async function defaultFindRecent(limit: number): Promise<IdpBaselineCheckRow[]> {
  const checks = await getDb()
    .select()
    .from(idpBaselineChecks)
    .orderBy(desc(idpBaselineChecks.checkedAt))
    .limit(limit)
  return checks.map(rowFromDb)
}

/** Project a stored check into the admin response body. */
export function idpBaselineCheckAdminView(row: IdpBaselineCheckRow): IdpBaselineCheckAdminView {
  return {
    id: row.id,
    checkedAt: row.checkedAt,
    checkedBy: row.checkedBy,
    mfaAvailable: row.mfaAvailable,
    claimsFound: row.claimsFound,
    error: row.error,
  }
}

/**
 * Decode → evaluate → store one baseline check for an admin.
 */
export async function recordIdpBaselineCheck(
  input: IdpBaselineCheckInput,
  deps: IdpBaselineCheckDeps = {},
): Promise<IdpBaselineCheckRow> {
  const decodeClaims = deps.decodeClaims ?? defaultDecode
  const evaluate = deps.evaluate ?? evaluateIdpMfaBaseline
  const store = deps.store ?? defaultStore

  let evaluation: IdpMfaBaselineEvaluation
  if (!input.idToken) {
    evaluation = evaluate(null)
  } else {
    try {
      evaluation = evaluate(decodeClaims(input.idToken))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Malformed id_token'
      evaluation = { mfaAvailable: false, claimsFound: null, error: message }
    }
  }

  return store({
    checkedBy: input.checkedBy,
    mfaAvailable: evaluation.mfaAvailable,
    claimsFound: evaluation.claimsFound,
    error: evaluation.error,
  })
}

/** Most recent baseline check as an admin view, or null when none exist. */
export async function latestIdpBaselineCheck(
  deps: IdpBaselineCheckReadDeps = {},
): Promise<IdpBaselineCheckAdminView | null> {
  const findLatest = deps.findLatest ?? defaultFindLatest
  const row = await findLatest()
  return row ? idpBaselineCheckAdminView(row) : null
}

/** Recent baseline checks (newest first) as admin views. */
export async function listIdpBaselineChecks(
  limit = 50,
  deps: IdpBaselineCheckReadDeps = {},
): Promise<IdpBaselineCheckAdminView[]> {
  const findRecent = deps.findRecent ?? defaultFindRecent
  const safeLimit = Math.max(1, Math.min(limit, 100))
  const rows = await findRecent(safeLimit)
  return rows.map(idpBaselineCheckAdminView)
}
