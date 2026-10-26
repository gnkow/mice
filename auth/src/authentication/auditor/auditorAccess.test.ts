import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createAuditorRole,
  isAuditorExpired,
  validateAuditorExpiry,
  validateAuditorMfa,
  validateAuditorOperation,
  validateAuditorRequest,
  logAuditorRead,
  authorizeAuditorAccess,
  type AuditorRole,
  type AuditorRequest,
} from './auditorAccess.js'

/**
 * TICKET 10: Auditor Access
 * 
 * Requirements:
 * - Auditor role via external IdP account
 * - Admin sets expiry date (enforced at every request)
 * - MFA required for auditor access
 * - Every read operation audited
 * - No write capability (read-only)
 * - No impersonation or support access
 */

describe('Auditor Role - Setup', () => {
  it('creates auditor role from IdP account', () => {
    const principal = { iss: 'https://idp.example.com', sub: 'auditor1', name: 'Auditor One' }
    const createdBy = { iss: 'https://idp.example.com', sub: 'admin1', name: 'Admin' }
    const now = Date.now()
    const expiresAt = now + 30 * 24 * 60 * 60 * 1000 // 30 days
    
    const role = createAuditorRole(principal, expiresAt, createdBy, now)
    assert.deepEqual(role.principal, principal)
    assert.deepEqual(role.createdBy, createdBy)
  })

  it('requires expiry date when creating auditor', () => {
    const principal = { iss: 'https://idp.example.com', sub: 'auditor1', name: 'Auditor' }
    const createdBy = { iss: 'https://idp.example.com', sub: 'admin1', name: 'Admin' }
    const now = Date.now()
    
    assert.throws(
      () => createAuditorRole(principal, 0, createdBy, now),
      /requires valid expiry date/
    )
  })

  it('stores expiry date with auditor role', () => {
    const principal = { iss: 'https://idp.example.com', sub: 'auditor1', name: 'Auditor' }
    const createdBy = { iss: 'https://idp.example.com', sub: 'admin1', name: 'Admin' }
    const now = Date.now()
    const expiresAt = now + 30 * 24 * 60 * 60 * 1000
    
    const role = createAuditorRole(principal, expiresAt, createdBy, now)
    assert.equal(role.expiresAt, expiresAt)
  })
})

describe('Auditor Role - Expiry Enforcement', () => {
  it('allows access before expiry date', () => {
    const now = Date.now()
    const expiresAt = now + 30 * 24 * 60 * 60 * 1000
    const role = createAuditorRole(
      { iss: 'https://idp.example.com', sub: 'auditor', name: 'Auditor' },
      expiresAt,
      { iss: 'https://idp.example.com', sub: 'admin', name: 'Admin' },
      now
    )
    
    assert.equal(isAuditorExpired(role, now), false)
    assert.doesNotThrow(() => validateAuditorExpiry(role, now))
  })

  it('blocks access after expiry date', () => {
    const now = Date.now()
    const expiresAt = now + 1000
    const role = createAuditorRole(
      { iss: 'https://idp.example.com', sub: 'auditor', name: 'Auditor' },
      expiresAt,
      { iss: 'https://idp.example.com', sub: 'admin', name: 'Admin' },
      now
    )
    
    const afterExpiry = expiresAt + 1
    assert.ok(isAuditorExpired(role, afterExpiry))
    assert.throws(
      () => validateAuditorExpiry(role, afterExpiry),
      /Auditor access has expired/
    )
  })

  it('checks expiry at every request', () => {
    const now = Date.now()
    const expiresAt = now + 1000
    const role = createAuditorRole(
      { iss: 'https://idp.example.com', sub: 'auditor', name: 'Auditor' },
      expiresAt,
      { iss: 'https://idp.example.com', sub: 'admin', name: 'Admin' },
      now
    )
    
    const request: AuditorRequest = {
      auditor: role,
      operation: 'read',
      resource: '/data',
      mfaVerified: true,
      timestamp: expiresAt + 1,
    }
    
    assert.throws(
      () => validateAuditorRequest(request),
      /expired/
    )
  })
})

describe('Auditor Role - MFA Requirement', () => {
  it('requires MFA for auditor access', () => {
    assert.doesNotThrow(() => validateAuditorMfa(true))
  })

  it('rejects auditor access without MFA', () => {
    assert.throws(
      () => validateAuditorMfa(false),
      /MFA required/
    )
  })
})

describe('Auditor Role - Read Operations Audited', () => {
  it('logs every read operation', () => {
    const auditor = { iss: 'https://idp.example.com', sub: 'auditor', name: 'Auditor' }
    const log = logAuditorRead(auditor, '/data/records', 123456)
    assert.equal(log.operation, 'read')
    assert.equal(log.resource, '/data/records')
    assert.equal(log.timestamp, 123456)
  })

  it('includes auditor identity in audit log', () => {
    const auditor = { iss: 'https://idp.example.com', sub: 'auditor1', name: 'Auditor One' }
    const log = logAuditorRead(auditor, '/data')
    assert.deepEqual(log.auditor, auditor)
  })
})

describe('Auditor Role - Read-Only Enforcement', () => {
  const now = Date.now()
  const expiresAt = now + 30 * 24 * 60 * 60 * 1000
  const role = createAuditorRole(
    { iss: 'https://idp.example.com', sub: 'auditor', name: 'Auditor' },
    expiresAt,
    { iss: 'https://idp.example.com', sub: 'admin', name: 'Admin' },
    now
  )

  it('allows read operations', () => {
    const request: AuditorRequest = {
      auditor: role,
      operation: 'read',
      resource: '/data',
      mfaVerified: true,
      timestamp: now,
    }
    assert.doesNotThrow(() => validateAuditorRequest(request))
  })

  it('blocks write operations', () => {
    assert.throws(
      () => validateAuditorOperation('write'),
      /cannot perform write/
    )
  })

  it('blocks delete operations', () => {
    assert.throws(
      () => validateAuditorOperation('delete'),
      /cannot perform delete/
    )
  })

  it('blocks impersonation', () => {
    assert.throws(
      () => validateAuditorOperation('impersonate'),
      /cannot perform impersonate/
    )
  })

  it('blocks support access', () => {
    assert.throws(
      () => validateAuditorOperation('support'),
      /cannot perform support/
    )
  })
})
