import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto'
import type { AuditActor, AuditEvent, AuditVerification } from './audit.js'
import { auditActionLabel } from './auditLabels.js'
import { env } from './env.js'

export const AUDIT_EXPORT_MANIFEST_FORMAT = 'mice-audit-export-manifest/1' as const
export const AUDIT_EXPORT_BUNDLE_FORMAT = 'mice-audit-bundle/3' as const

export type AuditExportManifestBody = {
  format: typeof AUDIT_EXPORT_MANIFEST_FORMAT
  exported_at: string
  exported_by: AuditActor
  event_count: number
  truncated: boolean
  /** SHA-256 hex of canonical event id+ts+action lines (stable offline check). */
  events_digest: string
  verification: {
    ok: boolean
    events: number
    verifiedAt: string
    head?: number
    root?: string
    firstBreak?: { seq: number; reason: string }
  }
  filters: Record<string, unknown>
}

export type SignedAuditExportManifest = AuditExportManifestBody & { signature: string }

/** Canonical bytes signed for the export manifest (ordered keys, no signature). */
export function canonicalExportManifest(body: AuditExportManifestBody): Buffer {
  const ordered = {
    format: body.format,
    exported_at: body.exported_at,
    exported_by: body.exported_by,
    event_count: body.event_count,
    truncated: body.truncated,
    events_digest: body.events_digest,
    verification: body.verification,
    filters: body.filters,
  }
  return Buffer.from(JSON.stringify(ordered), 'utf8')
}

/** Digest over export rows: one line per event `id ts action` in export order. */
export function eventsDigest(events: AuditEvent[]): string {
  const lines = events.map((e) => `${e.id} ${e.ts} ${e.action}`).join('\n')
  return createHash('sha256').update(lines).digest('hex')
}

export function buildExportManifestBody(input: {
  exportedAt: string
  exportedBy: AuditActor
  events: AuditEvent[]
  truncated: boolean
  verification: AuditVerification
  filters: Record<string, unknown>
}): AuditExportManifestBody {
  const v = input.verification
  return {
    format: AUDIT_EXPORT_MANIFEST_FORMAT,
    exported_at: input.exportedAt,
    exported_by: input.exportedBy,
    event_count: input.events.length,
    truncated: input.truncated,
    events_digest: eventsDigest(input.events),
    verification: {
      ok: v.ok,
      events: v.events,
      verifiedAt: v.verifiedAt,
      ...(v.ok ? { head: v.head, root: v.root } : { firstBreak: v.firstBreak }),
    },
    filters: input.filters,
  }
}

export function signAuditExportManifest(body: AuditExportManifestBody, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem)
  return cryptoSign(null, canonicalExportManifest(body), key).toString('base64url')
}

export function verifyAuditExportManifest(
  body: AuditExportManifestBody,
  signature: string,
  publicKeyPem: string,
): boolean {
  try {
    const key = createPublicKey(publicKeyPem)
    return cryptoVerify(null, canonicalExportManifest(body), key, Buffer.from(signature, 'base64url'))
  } catch {
    return false
  }
}

export function publicKeyPemFromPrivate(privateKeyPem: string): string {
  const priv = createPrivateKey(privateKeyPem)
  return createPublicKey(priv).export({ type: 'spki', format: 'pem' }).toString()
}

/** Ed25519 PKCS#8 PEM from env, or null when unsigned export must be refused. */
export function auditExportPrivateKeyPem(): string | null {
  // Prefer live process.env so tests that set AUDIT_EXPORT_PRIVATE_KEY after module load still work.
  const fromProc = process.env.AUDIT_EXPORT_PRIVATE_KEY?.replace(/\\n/g, '\n')
  const raw = (fromProc ?? env.auditExportPrivateKey)?.trim()
  return raw ? raw : null
}

export function auditExportPublicKeyPem(): string | null {
  const priv = auditExportPrivateKeyPem()
  if (!priv) return null
  try {
    return publicKeyPemFromPrivate(priv)
  } catch {
    return null
  }
}

/** Test helper: fresh Ed25519 pair as PEM strings. */
export function generateAuditExportKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

function pdfEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

/**
 * Minimal single-page Helvetica PDF listing events (Part 11 human-readable copy).
 * No third-party PDF dependency — inspectors get a readable attachment alongside CSV.
 */
export function auditEventsToPdf(events: AuditEvent[]): Buffer {
  const header = [
    'Mice audit export',
    `Events: ${events.length}`,
    `Generated: ${new Date().toISOString()}`,
    '',
  ]
  const rows = events.slice(0, 200).map((e) => {
    const label = auditActionLabel(e.action)
    const actor = e.actor.email || e.actor.name || e.actor.sub
    return `${e.ts}  ${e.action} (${label})  ${actor}  ${e.namespace ?? ''} ${e.repo ?? ''}  ${e.message ?? ''}`
  })
  if (events.length > 200) {
    rows.push(`… ${events.length - 200} more events (see CSV / machine bundle)`)
  }
  const lines = [...header, ...rows].map((l) => l.slice(0, 110))
  const contentLines = ['BT', '/F1 9 Tf', '50 780 Td', '12 TL']
  for (let i = 0; i < lines.length; i++) {
    if (i === 0) contentLines.push(`(${pdfEscape(lines[i]!)}) Tj`)
    else contentLines.push(`T* (${pdfEscape(lines[i]!)}) Tj`)
  }
  contentLines.push('ET')
  const stream = contentLines.join('\n')
  const objects: string[] = []
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
  objects.push(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
  )
  objects.push(`4 0 obj\n<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream\nendobj\n`)
  objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n')

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = [0]
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'))
    pdf += obj
  }
  const xrefStart = Buffer.byteLength(pdf, 'utf8')
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]!).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(pdf, 'utf8')
}
