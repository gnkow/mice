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
const { buildSignedRecordReport } = await import('./signedRecordReport.js')
const { queryAudit } = await import('./audit.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `report/${randomBytes(4).toString('hex')}/` }),
  ),
)

describe('signed-record report (gxp/20)', () => {
  it('GXP-R-008 lists approvals and revocations from immudb with machine-readable + PDF text', async () => {
    const merge = buildMergeManifest([{ path: 'a.csv', contentHash: 'bb'.repeat(32) }])
    const { binding, manifest } = mergeResultBinding({
      repo: 'lab/assay',
      sourceHead: 's',
      targetHead: 't',
      merge,
    })
    const { signatureStore } = await import('./authentication/signing/signatureStore.js')
    const store = await signatureStore()
    const { id } = await store.record({
      signer: { iss: 'idp', sub: 'approver', name: 'Dr. A' },
      meaning: 'Approved',
      contentHash: binding.manifestDigest,
      binding,
      manifest,
      changeControlId: 'CC-R',
    })
    await store.revoke({
      signatureId: id,
      revokedBy: { iss: 'idp', sub: 'approver', name: 'Dr. A' },
      reason: 'Batch failed QC',
      changeControlId: 'CC-R2',
      commitIds: ['s'],
    })

    const report = await buildSignedRecordReport('lab/assay')
    assert.ok(report.records.some((r) => r.kind === 'approval' && r.printedName === 'Dr. A'))
    assert.ok(report.records.some((r) => r.kind === 'revocation' && r.reason === 'Batch failed QC'))
    assert.match(report.machineReadable, /Dr\. A/)
    assert.match(report.pdfText, /%PDF/)
    const { events } = await queryAudit({ action: 'system.signed_record_report', limit: 5 })
    assert.ok(events.some((e) => e.action === 'system.signed_record_report'))
  })
})
