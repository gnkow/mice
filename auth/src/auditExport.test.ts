import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AUDIT_EXPORT_MANIFEST_FORMAT,
  auditEventsToPdf,
  buildExportManifestBody,
  eventsDigest,
  generateAuditExportKeyPair,
  publicKeyPemFromPrivate,
  signAuditExportManifest,
  verifyAuditExportManifest,
} from './auditExport.js'
import type { AuditEvent, AuditVerification } from './audit.js'

const actor = { sub: 'a1', iss: 'test', email: 'a@example.com', name: 'A' }

function event(partial: Partial<AuditEvent> & Pick<AuditEvent, 'id' | 'action'>): AuditEvent {
  return {
    ts: '2026-01-01T00:00:00.000Z',
    actor,
    via: 'session',
    method: 'POST',
    path: '/x',
    status: 200,
    ...partial,
  }
}

describe('audit export manifest sign/verify', () => {
  it('round-trips a signed manifest with the IQP public key', () => {
    const { privateKeyPem, publicKeyPem } = generateAuditExportKeyPair()
    assert.equal(publicKeyPemFromPrivate(privateKeyPem), publicKeyPem)

    const events = [
      event({ id: 'e1', action: 'audit.export' }),
      event({ id: 'e2', action: 'commit.publish', ts: '2026-01-02T00:00:00.000Z' }),
    ]
    const verification: AuditVerification = {
      ok: true,
      events: 2,
      verifiedAt: '2026-01-03T00:00:00.000Z',
      head: 42,
      root: 'abc',
    }
    const body = buildExportManifestBody({
      exportedAt: '2026-01-03T00:00:00.000Z',
      exportedBy: actor,
      events,
      truncated: false,
      verification,
      filters: { namespace: 'bk' },
    })
    assert.equal(body.format, AUDIT_EXPORT_MANIFEST_FORMAT)
    assert.equal(body.event_count, 2)
    assert.equal(body.events_digest, eventsDigest(events))
    assert.equal(body.verification.head, 42)

    const signature = signAuditExportManifest(body, privateKeyPem)
    assert.equal(verifyAuditExportManifest(body, signature, publicKeyPem), true)
    assert.equal(verifyAuditExportManifest(body, 'not-a-sig', publicKeyPem), false)
    assert.equal(
      verifyAuditExportManifest({ ...body, event_count: 99 }, signature, publicKeyPem),
      false,
    )
  })

  it('builds a PDF that starts with a PDF header and lists event actions', () => {
    const events = [event({ id: 'e1', action: 'commit.publish', message: 'ship it' })]
    const pdf = auditEventsToPdf(events)
    assert.ok(pdf.subarray(0, 5).toString() === '%PDF-')
    assert.ok(pdf.toString('latin1').includes('commit.publish'))
    assert.ok(pdf.toString('latin1').includes('Mice audit export'))
  })
})
