import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isAuthenticationFresh,
  validateSigningSession,
  computeContentHash,
  createSignature,
  verifySignatureHash,
  formatSignature,
  prepareForSigning,
  type SessionInfo,
} from './signingCeremony.js'
import { extractMfaEvidence } from './mfaEvidence.js'
import { decodeJwtPayload } from '../oidc/oidcClaims.js'

/**
 * Signing Ceremony Tests - Authentication Domain
 * 
 * Tests authentication-layer signature primitives:
 * - Fresh authentication validation
 * - MFA requirement enforcement
 * - Content hash computation
 * - Tamper detection
 * 
 * GxP-specific tests (merge approval, self-approval prevention, immudb storage)
 * belong in 04-gxp-compliance test suite.
 * 
 * Related: .scratch/authentication/issues/09-step-up-reauthentication.md
 */

describe('Signing Ceremony - Part 11 Compliance', () => {
  it('requires fresh authentication (<5 minutes)', () => {
    const now = Date.now()
    const twoMinutesAgo = now - 2 * 60 * 1000
    assert.ok(isAuthenticationFresh(twoMinutesAgo, now))
  })

  it('rejects signature if authentication is too old', () => {
    const now = Date.now()
    const sixMinutesAgo = now - 6 * 60 * 1000
    assert.equal(isAuthenticationFresh(sixMinutesAgo, now), false)
    
    const session: SessionInfo = {
      authenticatedAt: sixMinutesAgo,
      mfaVerified: true,
      principal: { iss: 'https://idp.example.com', sub: 'alice', name: 'Alice' },
    }
    assert.throws(
      () => validateSigningSession(session, now),
      /Authentication too old/
    )
  })

  it('requires MFA evidence in session', () => {
    const now = Date.now()
    const session: SessionInfo = {
      authenticatedAt: now - 1000,
      mfaVerified: true,
      principal: { iss: 'https://idp.example.com', sub: 'alice', name: 'Alice' },
    }
    assert.doesNotThrow(() => validateSigningSession(session, now))
  })

  it('rejects signature without MFA', () => {
    const now = Date.now()
    const session: SessionInfo = {
      authenticatedAt: now - 1000,
      mfaVerified: false,
      principal: { iss: 'https://idp.example.com', sub: 'alice', name: 'Alice' },
    }
    assert.throws(
      () => validateSigningSession(session, now),
      /MFA required/
    )
  })
})

describe('Signing Ceremony - Cryptographic Hash', () => {
  it('computes SHA-256 hash of record being signed', () => {
    const content = 'Important document'
    const hash = computeContentHash(content)
    assert.equal(typeof hash, 'string')
    assert.equal(hash.length, 64) // SHA-256 is 64 hex chars
  })

  it('displays exact record content before signing', () => {
    const content = 'Document to sign'
    const prepared = prepareForSigning(content)
    assert.equal(prepared.content, content)
    assert.equal(typeof prepared.hash, 'string')
  })

  it('binds hash to signature', () => {
    const content = 'Important record'
    const session: SessionInfo = {
      authenticatedAt: Date.now(),
      mfaVerified: true,
      principal: { iss: 'https://idp.example.com', sub: 'alice', name: 'Alice' },
    }
    const signature = createSignature(content, 'Approved', session)
    assert.equal(signature.hash, computeContentHash(content))
  })

  it('detects tampering if record changes after signing', () => {
    const originalContent = 'Original document'
    const session: SessionInfo = {
      authenticatedAt: Date.now(),
      mfaVerified: true,
      principal: { iss: 'https://idp.example.com', sub: 'alice', name: 'Alice' },
    }
    const signature = createSignature(originalContent, 'Approved', session)
    
    const tamperedContent = 'Tampered document'
    assert.equal(verifySignatureHash(signature, tamperedContent), false)
    assert.ok(verifySignatureHash(signature, originalContent))
  })
})

describe('Signing Ceremony - Signature Meaning', () => {
  const session: SessionInfo = {
    authenticatedAt: Date.now(),
    mfaVerified: true,
    principal: { iss: 'https://idp.example.com', sub: 'alice', name: 'Alice' },
  }

  it('records "Authored" meaning', () => {
    const sig = createSignature('Content', 'Authored', session)
    assert.equal(sig.meaning, 'Authored')
  })

  it('records "Reviewed" meaning', () => {
    const sig = createSignature('Content', 'Reviewed', session)
    assert.equal(sig.meaning, 'Reviewed')
  })

  it('records "Approved" meaning', () => {
    const sig = createSignature('Content', 'Approved', session)
    assert.equal(sig.meaning, 'Approved')
  })
})

describe('Signing Ceremony - Identity Capture', () => {
  it('captures full name at signing time', () => {
    const session: SessionInfo = {
      authenticatedAt: Date.now(),
      mfaVerified: true,
      principal: { iss: 'https://idp.example.com', sub: 'alice', name: 'Alice Smith' },
    }
    const sig = createSignature('Content', 'Approved', session)
    assert.equal(sig.principal.name, 'Alice Smith')
  })

  it('captures iss+sub at signing time', () => {
    const session: SessionInfo = {
      authenticatedAt: Date.now(),
      mfaVerified: true,
      principal: { iss: 'https://idp.example.com', sub: 'alice123', name: 'Alice' },
    }
    const sig = createSignature('Content', 'Approved', session)
    assert.equal(sig.principal.iss, 'https://idp.example.com')
    assert.equal(sig.principal.sub, 'alice123')
  })

  it('captures timestamp at signing time', () => {
    const now = Date.now()
    const session: SessionInfo = {
      authenticatedAt: now,
      mfaVerified: true,
      principal: { iss: 'https://idp.example.com', sub: 'alice', name: 'Alice' },
    }
    const sig = createSignature('Content', 'Approved', session, now)
    assert.equal(sig.signedAt, now)
  })
})

describe('Signing Ceremony - MFA Evidence Integration', () => {
  // Helper to create minimal JWT for testing
  function createTestIdToken(claims: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
    return `${header}.${payload}.`
  }

  it('extracts MFA evidence from id_token for signing validation', () => {
    const idToken = createTestIdToken({
      sub: 'alice',
      iss: 'https://idp.example.com',
      acr: 'mfa',
      amr: ['pwd', 'otp'],
      auth_time: 1234567890,
    })

    const payload = decodeJwtPayload(idToken)
    const evidence = extractMfaEvidence(payload)

    assert.equal(evidence.hasMfa, true)
    assert.equal(evidence.acr, 'mfa')
    assert.deepEqual(evidence.amr, ['pwd', 'otp'])

    // Verify signing would succeed with this evidence
    const session: SessionInfo = {
      authenticatedAt: Date.now(),
      mfaVerified: evidence.hasMfa,
      principal: { iss: 'https://idp.example.com', sub: 'alice', name: 'Alice' },
    }

    assert.doesNotThrow(() => validateSigningSession(session))
  })

  it('detects lack of MFA from id_token (password-only)', () => {
    const idToken = createTestIdToken({
      sub: 'bob',
      iss: 'https://idp.example.com',
      acr: 'password',
      amr: ['pwd'], // Single method
      auth_time: 1234567890,
    })

    const payload = decodeJwtPayload(idToken)
    const evidence = extractMfaEvidence(payload)

    assert.equal(evidence.hasMfa, false)

    // Verify signing would fail without MFA
    const session: SessionInfo = {
      authenticatedAt: Date.now(),
      mfaVerified: evidence.hasMfa,
      principal: { iss: 'https://idp.example.com', sub: 'bob', name: 'Bob' },
    }

    assert.throws(() => validateSigningSession(session), /MFA required/)
  })

  it('handles missing MFA claims in id_token', () => {
    const idToken = createTestIdToken({
      sub: 'charlie',
      iss: 'https://idp.example.com',
      auth_time: 1234567890,
      // NO acr/amr claims
    })

    const payload = decodeJwtPayload(idToken)
    const evidence = extractMfaEvidence(payload)

    assert.equal(evidence.hasMfa, false)
    assert.equal(evidence.acr, undefined)
    assert.deepEqual(evidence.amr, [])
  })
})
