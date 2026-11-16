import { appendAudit } from './audit.js'
import { signatureStore } from './authentication/signing/signatureStore.js'

export type SignedRecordRow = {
  signatureId: string
  kind: 'approval' | 'revocation'
  meaning?: string
  signedAt?: string
  printedName?: string
  iss?: string
  sub?: string
  binding?: {
    repo: string
    sourceHead: string
    targetHead: string
    manifestDigest: string
  }
  reason?: string
  changeControlId?: string
  revokedAt?: string
}

export type SignedRecordReport = {
  repository: string
  generatedAt: string
  records: SignedRecordRow[]
  machineReadable: string
  /** Minimal PDF-ish text payload suitable for download (not a full PDF engine). */
  pdfText: string
}

/**
 * Per-repository signed-record report from authoritative immudb signatures + revocations (gxp/20).
 */
export async function buildSignedRecordReport(repository: string): Promise<SignedRecordReport> {
  const store = await signatureStore()
  const indexed = await store.find({ repo: repository })
  const records: SignedRecordRow[] = []

  for (const row of indexed) {
    const found = await store.get(row.id)
    if (!found) continue
    const r = found.record
    records.push({
      signatureId: r.id,
      kind: 'approval',
      meaning: r.meaning,
      signedAt: r.signedAt,
      printedName: r.signer.name,
      iss: r.signer.iss,
      sub: r.signer.sub,
      binding: r.binding,
      changeControlId: r.changeControlId,
    })
    for (const rev of await store.listRevocations(r.id)) {
      records.push({
        signatureId: r.id,
        kind: 'revocation',
        reason: rev.reason,
        changeControlId: rev.changeControlId,
        revokedAt: rev.revokedAt,
        binding: r.binding,
        printedName: r.signer.name,
        iss: r.signer.iss,
        sub: r.signer.sub,
      })
    }
  }

  const generatedAt = new Date().toISOString()
  const machineReadable = JSON.stringify({ repository, generatedAt, records }, null, 2)
  const pdfText = [
    '%PDF-1.1',
    `Mice signed-record report for ${repository}`,
    `Generated ${generatedAt}`,
    ...records.map(
      (row) =>
        `${row.kind.toUpperCase()} ${row.signatureId} ${row.printedName ?? ''} ${row.signedAt ?? row.revokedAt ?? ''} ${row.meaning ?? row.reason ?? ''}`,
    ),
    '%%EOF',
  ].join('\n')

  await appendAudit({
    actor: { sub: 'system', iss: 'mice', email: 'system@mice', name: 'Mice' },
    via: 'system',
    method: 'SYSTEM',
    path: '/auth/repos/signed-record-report',
    status: 200,
    action: 'system.signed_record_report',
    message: `Signed-record report generated for ${repository}`,
    detail: { repository, recordCount: records.length },
  })

  return { repository, generatedAt, records, machineReadable, pdfText }
}
