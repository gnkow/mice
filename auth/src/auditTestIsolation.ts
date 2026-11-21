/**
 * Deep seam for audit ledger test isolation under concurrent processes.
 * Owns key-prefix allocation and scoped event reads so files share one
 * immudb database without seeing each other's trail.
 */
import { randomUUID } from 'node:crypto'
import { immudbConfig, openLedger, type Ledger, type LedgerRecord } from './auditLedger.js'

/** Allocate a private immudb key space (does not mutate env). */
export function allocateAuditKeyPrefix(namespace = 'audit'): string {
  return `${namespace}/${randomUUID()}/`
}

/**
 * Install a private key prefix for this process (`IMMUDB_KEY_PREFIX`).
 * Call again before `openLedger` when running with `--test-isolation=none`.
 */
export function installAuditKeyPrefix(prefix = allocateAuditKeyPrefix()): string {
  process.env.IMMUDB_KEY_PREFIX = prefix
  return prefix
}

/** Open a ledger under a fresh private prefix (independent of process env). */
export async function openIsolatedTestLedger(
  namespace = 'ledger-test',
): Promise<{ ledger: Ledger; prefix: string }> {
  const prefix = allocateAuditKeyPrefix(namespace)
  const ledger = await openLedger({ ...immudbConfig(), prefix })
  return { ledger, prefix }
}

export type ScopedAuditRow = {
  id: string
  action: string
  phase?: string
  intent_id?: string
  status: number
  path: string
  actor: { sub: string }
}

/**
 * Events written after `since`, optionally limited to the given actor subs.
 * Oldest first. Callers that share a database must filter — never assert on
 * the whole trail.
 */
export async function ledgerEventsSince(
  ledger: Pick<Ledger, 'readAll'>,
  since: number,
  opts: { actors?: ReadonlySet<string> } = {},
): Promise<ScopedAuditRow[]> {
  const records = await ledger.readAll()
  return records
    .filter((r) => r.seq > since)
    .map((r) => JSON.parse(r.value) as ScopedAuditRow)
    .filter((row) => (opts.actors ? opts.actors.has(row.actor?.sub) : true))
}

/** Highest sequence currently on the ledger (0 when empty). */
export async function ledgerHeadSeq(ledger: Pick<Ledger, 'readAll'>): Promise<number> {
  return (await ledger.readAll()).reduce((m: number, r: LedgerRecord) => Math.max(m, r.seq), 0)
}
