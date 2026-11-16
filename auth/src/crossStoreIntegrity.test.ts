import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { isolatedAuth } from './testSupport.js'

const t = isolatedAuth()
after(() => t.restore())

const { openSignatureStore, useSignatureStore } = await import('./authentication/signing/signatureStore.js')
const { buildMergeManifest, mergeResultBinding } = await import('./authentication/signing/mergeManifest.js')
const { immudbConfig, openLedger } = await import('./auditLedger.js')
const { runCrossStoreIntegrity, startCrossStoreIntegritySchedule } = await import(
  './crossStoreIntegrity.js'
)
const { queryAudit } = await import('./audit.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `integ/${randomBytes(4).toString('hex')}/` }),
  ),
)

describe('cross-store integrity (gxp/19)', () => {
  it('GXP-R-063 reports missing commits without repairing and audits the run', async () => {
    const merge = buildMergeManifest([])
    const { binding, manifest } = mergeResultBinding({
      repo: 'ns/r',
      sourceHead: 'missing-src',
      targetHead: 'missing-tgt',
      merge,
    })
    const { signatureStore } = await import('./authentication/signing/signatureStore.js')
    await (
      await signatureStore()
    ).record({
      signer: { iss: 'idp', sub: 's', name: 'S' },
      meaning: 'Approved',
      contentHash: binding.manifestDigest,
      binding,
      manifest,
      changeControlId: 'CC-I',
    })

    const report = await runCrossStoreIntegrity({
      commitExists: async () => false,
      notify: async () => {},
    })
    assert.ok(report.findings.length >= 2)
    assert.ok(report.findings.every((f) => f.code === 'missing_commit'))
    const { events } = await queryAudit({ action: 'system.integrity_check', limit: 5 })
    assert.ok(events.some((e) => e.action === 'system.integrity_check'))
  })

  it('schedule tick runs the report-only job', async () => {
    let runs = 0
    const schedule = startCrossStoreIntegritySchedule({
      poll: false,
      run: async () => {
        runs += 1
        return {
          runId: 'sched-1',
          generatedAt: new Date().toISOString(),
          findings: [],
          checkedSignatures: 0,
        }
      },
    })
    await schedule.tick()
    assert.equal(runs, 1)
    schedule.stop()
  })
})
