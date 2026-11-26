import { EMPTY_AUDIT_CHANGE } from '../../audit/change.js'
import { appendAudit } from '../../audit/index.js'
import { signatureStore } from '../../authentication/signing.js'
import { emitNotification } from '../../notifications/index.js'
import type { NotificationEvent } from '../../notifications/index.js'

export type IntegrityFinding = {
  code: string
  detail: string
  signatureId?: string
  commitId?: string
}

export type IntegrityReport = {
  runId: string
  generatedAt: string
  findings: IntegrityFinding[]
  checkedSignatures: number
}

/**
 * Report-only cross-store check: signatures ↔ binding heads present.
 * Never deletes or repairs (gxp/19). Oxen existence is pluggable.
 */
export async function runCrossStoreIntegrity(opts?: {
  commitExists?: (repo: string, commitId: string) => Promise<boolean>
  notify?: (event: NotificationEvent) => Promise<void>
}): Promise<IntegrityReport> {
  const store = await signatureStore()
  const indexed = await store.find({})
  const findings: IntegrityFinding[] = []
  const commitExists = opts?.commitExists ?? (async () => true)

  for (const row of indexed) {
    const found = await store.get(row.id)
    if (!found) {
      findings.push({
        code: 'index_orphan',
        detail: 'Postgres signature index row has no ledger record',
        signatureId: row.id,
      })
      continue
    }
    const binding = found.record.binding
    if (!binding) continue
    for (const commitId of [binding.sourceHead, binding.targetHead]) {
      if (!(await commitExists(binding.repo, commitId))) {
        findings.push({
          code: 'missing_commit',
          detail: `Bound commit ${commitId} not found in oxen for ${binding.repo}`,
          signatureId: row.id,
          commitId,
        })
      }
    }
  }

  const report: IntegrityReport = {
    runId: globalThis.crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    findings,
    checkedSignatures: indexed.length,
  }

  await appendAudit({
    actor: { sub: 'system', iss: 'mice', email: 'system@mice', name: 'Mice' },
    via: 'system',
    method: 'SYSTEM',
    path: '/auth/admin/integrity',
    status: findings.length ? 409 : 200,
    action: 'system.integrity_check',
    change: EMPTY_AUDIT_CHANGE,
    message:
      findings.length === 0
        ? 'Cross-store integrity check clean'
        : `Cross-store integrity check found ${findings.length} issue(s)`,
    detail: {
      runId: report.runId,
      checkedSignatures: report.checkedSignatures,
      findingCodes: findings.map((f) => f.code),
    },
  })

  if (findings.length > 0) {
    const notify = opts?.notify ?? emitNotification
    try {
      await notify({
        id: `integrity-${report.runId}`,
        category: 'security',
        title: 'Integrity check findings',
        summary: `${findings.length} cross-store integrity finding(s) on signature/commit check`,
        createdAt: new Date().toISOString(),
        audience: 'access-reviewers',
      })
    } catch {
      /* alert best-effort */
    }
  }

  return report
}

export type IntegrityScheduleDeps = {
  run?: typeof runCrossStoreIntegrity
  /** When false, skip the interval timer (tests drive `tick` directly). */
  poll?: boolean
  intervalMs?: number
}

/** Daily report-only integrity check (gxp/19). */
export function startCrossStoreIntegritySchedule(opts: IntegrityScheduleDeps = {}) {
  const intervalMs = opts.intervalMs ?? 24 * 60 * 60 * 1000
  const run = opts.run ?? runCrossStoreIntegrity
  const tick = async () => run()
  const safe = () => {
    void tick().catch((err) => console.error('[mice-auth] cross-store integrity check failed', err))
  }
  const timer = opts.poll === false ? undefined : setInterval(safe, intervalMs)
  timer?.unref()
  return { tick, stop: () => clearInterval(timer) }
}
