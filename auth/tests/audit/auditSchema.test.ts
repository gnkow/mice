import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  auditActionMatches,
  canonicalAuditAction,
  CURRENT_AUDIT_SCHEMA_VERSION,
  upcastAuditEvent,
} from '../../src/packages/audit/lib/auditSchema.js'

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
      namespace: 'n',
      repo: 'r',
    })
    assert.equal(ev.schema_version, CURRENT_AUDIT_SCHEMA_VERSION)
    assert.equal(ev.action, 'stage.commit')
    assert.equal(ev.resource_uri, 'repo:n/r')
  })

  it('preserves a stored resource_uri on upcast', () => {
    const ev = upcastAuditEvent({
      id: 'a2',
      ts: '2026-01-01T00:00:00.000Z',
      actor: { sub: 's', iss: 'i', email: 'e', name: 'n' },
      via: 'session',
      method: 'POST',
      path: '/x',
      status: 200,
      action: 'job.publish',
      resource_uri: 'job:explicit',
      schema_version: 2,
    })
    assert.equal(ev.resource_uri, 'job:explicit')
    assert.deepEqual(ev.change, { before: null, after: null })
  })

  it('preserves a stored change on upcast', () => {
    const ev = upcastAuditEvent({
      id: 'a3',
      ts: '2026-01-01T00:00:00.000Z',
      actor: { sub: 's', iss: 'i', email: 'e', name: 'n' },
      via: 'session',
      method: 'PATCH',
      path: '/x',
      status: 200,
      action: 'namespace.settings.update',
      change: { before: { description: null }, after: { description: 'example' } },
      schema_version: 3,
    })
    assert.deepEqual(ev.change, { before: { description: null }, after: { description: 'example' } })
  })

  it('resolves action aliases for filters', () => {
    assert.equal(canonicalAuditAction('stage.commit'), 'workspace.commit')
    assert.equal(auditActionMatches('stage.commit', 'workspace.commit'), true)
    assert.equal(auditActionMatches('workspace.commit', 'stage.commit'), true)
    assert.equal(auditActionMatches('merge', 'file'), false)
  })
})
