import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  auditActionMatches,
  canonicalAuditAction,
  CURRENT_AUDIT_SCHEMA_VERSION,
  upcastAuditEvent,
} from './auditSchema.js'

describe('auditSchema', () => {
  it('upcasts pre-versioned events to the current schema_version', () => {
    const ev = upcastAuditEvent({
      id: 'a1',
      ts: '2026-01-01T00:00:00.000Z',
      actor: { sub: 's', iss: 'i', email: 'e', name: 'n' },
      via: 'session',
      method: 'POST',
      path: '/x',
      status: 200,
      action: 'stage.commit',
    })
    assert.equal(ev.schema_version, CURRENT_AUDIT_SCHEMA_VERSION)
    assert.equal(ev.action, 'stage.commit')
  })

  it('resolves action aliases for filters', () => {
    assert.equal(canonicalAuditAction('stage.commit'), 'workspace.commit')
    assert.equal(auditActionMatches('stage.commit', 'workspace.commit'), true)
    assert.equal(auditActionMatches('workspace.commit', 'stage.commit'), true)
    assert.equal(auditActionMatches('merge', 'file'), false)
  })
})
