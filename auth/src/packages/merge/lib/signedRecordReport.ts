import { EMPTY_AUDIT_CHANGE } from '../../audit/change.js'
import { appendAudit } from '../../audit/index.js'
import { textLinesToPdf } from '../../audit/index.js'
import { signatureStore } from '../../authentication/signing.js'

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
  /** Valid single-page Helvetica PDF (same builder as audit export). */
  pdf: Buffer
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
  const pdfLines = [
    'Mice signed-record report',
    `Repository: ${repository}`,
    `Generated: ${generatedAt}`,
    `Records: ${records.length}`,
    '',
  ]
  if (records.length === 0) {
    pdfLines.push('No signatures recorded for this repository yet.')
  } else {
    for (const row of records) {
      pdfLines.push(...signedRecordToPdfLines(row), '')
    }
  }
  const pdf = textLinesToPdf(pdfLines)

  await appendAudit({
    actor: { sub: 'system', iss: 'mice', email: 'system@mice', name: 'Mice' },
    via: 'system',
    method: 'SYSTEM',
    path: '/auth/repos/signed-record-report',
    status: 200,
    action: 'system.signed_record_report',
    change: EMPTY_AUDIT_CHANGE,
    message: `Signed-record report generated for ${repository}`,
    detail: { repository, recordCount: records.length },
  })

  return { repository, generatedAt, records, machineReadable, pdf }
}

/** One record → labeled lines matching the machine-readable fields (human PDF). */
export function signedRecordToPdfLines(row: SignedRecordRow): string[] {
  const lines = [`--- ${row.kind.toUpperCase()} ---`, `Signature id: ${row.signatureId}`]
  if (row.changeControlId) lines.push(`Change-control: ${row.changeControlId}`)
  if (row.meaning) lines.push(`Meaning: ${row.meaning}`)
  if (row.reason) lines.push(`Reason: ${row.reason}`)
  if (row.printedName) lines.push(`Printed name: ${row.printedName}`)
  if (row.iss || row.sub) {
    lines.push(`Identity: ${[row.iss, row.sub].filter(Boolean).join(' | ')}`)
  }
  if (row.signedAt) lines.push(`Signed at: ${row.signedAt}`)
  if (row.revokedAt) lines.push(`Revoked at: ${row.revokedAt}`)
  if (row.binding) {
    lines.push(`Binding repo: ${row.binding.repo}`)
    lines.push(`Source head: ${row.binding.sourceHead}`)
    lines.push(`Target head: ${row.binding.targetHead}`)
    lines.push(`Manifest digest: ${row.binding.manifestDigest}`)
  }
  return lines
}
