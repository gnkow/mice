import { currentClock } from '../../shared/index.js'
import { auditEventsToCsv, queryAuditForExport } from './auditQuery.js'
import { verifyAudit } from './auditVerify.js'
import type { AuditActor, AuditQuery } from './auditTypes.js'

/** Evidence bundle for the events matching `query`, with a fresh verification of the ledger; see GLOSSARY "audit bundle". */
export async function buildAuditExportBundle(
  query: AuditQuery,
  exportedBy: AuditActor,
  filters: Record<string, unknown>,
): Promise<{ ok: true; bundle: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const {
      AUDIT_EXPORT_BUNDLE_FORMAT,
      auditEventsToPdf,
      auditExportPrivateKeyPem,
      auditExportPublicKeyPem,
      buildExportManifestBody,
      signAuditExportManifest,
    } = await import('./auditExport.js')
    const privateKeyPem = auditExportPrivateKeyPem()
    const publicKeyPem = auditExportPublicKeyPem()
    if (!privateKeyPem || !publicKeyPem) {
      return {
        ok: false,
        error: 'Audit export signing key is not configured (set AUDIT_EXPORT_PRIVATE_KEY)',
      }
    }
    const { events: found, truncated } = await queryAuditForExport(query)
    const verification = await verifyAudit()
    const exportedAt = new Date(currentClock.now()).toISOString()
    // Bundle events are chain order (oldest first); CSV/PDF keep newest-first browse order.
    const chainEvents = [...found].reverse()
    const manifestBody = buildExportManifestBody({
      exportedAt,
      exportedBy,
      events: chainEvents,
      truncated,
      verification,
      filters,
    })
    let signature: string
    try {
      signature = signAuditExportManifest(manifestBody, privateKeyPem)
    } catch (err) {
      return { ok: false, error: `Audit export signing failed: ${String((err as Error)?.message ?? err)}` }
    }
    const csv = auditEventsToCsv(found)
    const pdf = auditEventsToPdf(found)
    return {
      ok: true,
      bundle: {
        format: AUDIT_EXPORT_BUNDLE_FORMAT,
        exported_at: exportedAt,
        exported_by: exportedBy,
        range: filters,
        truncated,
        events: chainEvents,
        verification,
        manifest: { ...manifestBody, signature },
        public_key: publicKeyPem,
        csv,
        pdf_base64: pdf.toString('base64'),
      },
    }
  } catch (err) {
    return { ok: false, error: `Audit store unavailable: ${String((err as Error)?.message ?? err)}` }
  }
}
