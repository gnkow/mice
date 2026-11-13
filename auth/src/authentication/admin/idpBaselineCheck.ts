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
 * and persist the storeable result. Routes stay HTTP/audit adapters.
 */

export type IdpBaselineCheckRow = {
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

function defaultDecode(idToken: string): Record<string, unknown> {
  return decodeJwtPayload(idToken)
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
  return {
    id: check.id,
    checkedAt: check.checkedAt,
    checkedBy: check.checkedBy,
    mfaAvailable: check.mfaAvailable,
    claimsFound: check.claimsFound as IdpBaselineClaimsFound | null,
    error: check.error,
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
