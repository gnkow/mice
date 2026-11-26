import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { isolatedAuth } from '../src/packages/shared/lib/testSupport.js'

const t = isolatedAuth()
after(() => t.restore())

const { openSignatureStore, useSignatureStore } = await import('../src/packages/authentication/lib/signing/signatureStore.js')
const { buildMergeManifest, mergeResultBinding } = await import('../src/packages/authentication/lib/signing/mergeManifest.js')
const { immudbConfig, openLedger } = await import('../src/packages/audit/lib/auditLedger.js')
const { buildSignedRecordReport } = await import('../src/packages/merge/lib/signedRecordReport.js')
const { queryAudit } = await import('../src/packages/audit/lib/audit.js')

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
    const { signatureStore } = await import('../src/packages/authentication/lib/signing/signatureStore.js')
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
    assert.equal(report.pdf.subarray(0, 5).toString('utf8'), '%PDF-')
    const pdfBody = report.pdf.toString('latin1')
    assert.match(pdfBody, /\/Type \/Catalog/)
    assert.match(pdfBody, /\bxref\b/)
    assert.match(pdfBody, /Dr\. A/)
    assert.match(pdfBody, /APPROVAL/)
    assert.match(pdfBody, /REVOCATION/)
    assert.match(pdfBody, /Change-control: CC-R/)
    assert.match(pdfBody, /Meaning: Approved/)
    assert.match(pdfBody, /Reason: Batch failed QC/)
    assert.match(pdfBody, /Binding repo: lab\/assay/)
    assert.match(pdfBody, /Source head: s/)
    assert.match(pdfBody, /Target head: t/)
    assert.match(pdfBody, /Manifest digest:/)
    assert.match(pdfBody, /Identity: idp \| approver/)
    const { events } = await queryAudit({ action: 'system.signed_record_report', limit: 5 })
    assert.ok(events.some((e) => e.action === 'system.signed_record_report'))
  })
})
