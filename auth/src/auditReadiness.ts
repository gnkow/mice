import type { AuditVerification } from './auditChainGate.js'

export type AuditReadiness = {
  ok: boolean
  store: 'ok' | 'error'
  chain: 'ok' | 'broken' | 'acknowledged' | 'unverified'
  events?: number
  verifiedAt?: string
  /** Tip tx id from the last successful verify — for IQP / change-control filing. */
  head?: number
  /** Tip root (base64 ALH) from the last successful verify. */
  root?: string
  firstBreak?: { seq: number; reason: string }
  detail?: string
}

export type AuditHealthProbe = { ok: true } | { ok: false; detail: string }

/**
 * Compose store + chain tip into the readiness shape `/readyz` and admin health expose.
 * Pure: unit-test every chain state without opening immudb.
 */
export function composeAuditReadiness(input: {
  lastAppendError: string | null
  health: AuditHealthProbe
  verification: AuditVerification | null
  chainBlocked: boolean
}): AuditReadiness {
  let store: 'ok' | 'error' = input.lastAppendError ? 'error' : 'ok'
  let detail = input.lastAppendError ?? undefined
  if (!input.health.ok) {
    store = 'error'
    detail = input.health.detail
  } else {
    // The ledger answers again; do not stay red on a stale append error.
    store = 'ok'
    detail = undefined
  }
  const v = input.verification
  const chainState: AuditReadiness['chain'] = !v
    ? 'unverified'
    : v.ok
      ? 'ok'
      : input.chainBlocked
        ? 'broken'
        : 'acknowledged'
  return {
    ok: store === 'ok' && chainState !== 'broken',
    store,
    chain: chainState,
    ...(v ? { events: v.events, verifiedAt: v.verifiedAt } : {}),
    ...(v && v.ok ? { head: v.head, root: v.root } : {}),
    ...(v && !v.ok ? { firstBreak: v.firstBreak } : {}),
    ...(detail ? { detail } : {}),
  }
}

/** Ports for the live readiness probe (injected by audit.ts). */
export type AuditReadinessPorts = {
  lastAppendError: () => string | null
  health: () => Promise<AuditHealthProbe>
  currentVerification: () => AuditVerification | null
  isChainBlocked: () => boolean
}

/** Cheap: pings the ledger via ports and composes readiness; never walks proofs. */
export async function auditReadiness(ports: AuditReadinessPorts): Promise<AuditReadiness> {
  const health = await ports.health().catch((err: unknown) => ({
    ok: false as const,
    detail: String(err),
  }))
  return composeAuditReadiness({
    lastAppendError: ports.lastAppendError(),
    health,
    verification: ports.currentVerification(),
    chainBlocked: ports.isChainBlocked(),
  })
}
