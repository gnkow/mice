import './db/testSchema.js'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractVerificationMetadata } from './authentication/oidc/tokenVerificationMetadata.js'
import { createSignature, type SessionInfo, type SignatureRecord } from './authentication/signing/signingCeremony.js'

/**
 * Signature Evidence Metadata Tests (Ticket 26)
 * 
 * Round 8 decision U19: Store both extracted IdP claims (acr, amr, auth_time)
 * AND verification metadata (JWKS key ID, verification timestamp, issuer).
 * 
 * This proves Mice validated the IdP's assertion rather than just copying
 * claims blindly (Part 11 §11.200 evidence requirements).
 * 
 * Inspector question: "How do you know the IdP didn't lie or have a bug?"
 * Answer: We store the JWKS key ID used to verify the cryptographic signature,
 * proving we validated the IdP's signed assertion.
 * 
 * Related:
 * - .scratch/authentication/issues/26-signature-evidence-metadata.md
 * - Round 8 decision U19
 * - Part 11 §11.200
 */

describe('Signature Evidence Metadata (U19)', () => {
  // Mock id_token with standard JWT structure
  const mockIdToken = [
    // Header
    Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'key-2024-01', typ: 'JWT' })).toString('base64url'),
    // Payload
    Buffer.from(JSON.stringify({
      iss: 'https://idp.example.com',
      sub: 'alice',
      aud: 'mice-client',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      auth_time: Math.floor(Date.now() / 1000) - 60,
      acr: 'urn:mace:incommon:iap:silver',
      amr: ['pwd', 'otp'],
    })).toString('base64url'),
    // Signature (mock - not actually verified in these tests)
    'mock-signature',
  ].join('.')

  it('extracts JWKS key ID from id_token header', () => {
    const metadata = extractVerificationMetadata(mockIdToken)
    
    assert.equal(metadata.jwks_key_id, 'key-2024-01', 'Should extract kid from JWT header')
  })

  it('extracts IdP issuer from id_token claims', () => {
    const metadata = extractVerificationMetadata(mockIdToken)
    
    assert.equal(metadata.idp_issuer, 'https://idp.example.com', 'Should extract iss from verified claims')
  })

  it('captures token verification timestamp', () => {
    const beforeVerify = Date.now()
    const metadata = extractVerificationMetadata(mockIdToken)
    const afterVerify = Date.now()
    
    assert.ok(
      metadata.token_verified_at >= beforeVerify && metadata.token_verified_at <= afterVerify,
      'Verification timestamp should be capture time'
    )
  })

  it('throws if kid missing from header', () => {
    const tokenWithoutKid = [
      Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ iss: 'https://idp.test', sub: 'bob' })).toString('base64url'),
      'sig',
    ].join('.')
    
    assert.throws(
      () => extractVerificationMetadata(tokenWithoutKid),
      /missing kid/,
      'Should reject token without kid'
    )
  })

  it('throws if iss missing from claims', () => {
    const tokenWithoutIss = [
      Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'key1', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: 'charlie' })).toString('base64url'),
      'sig',
    ].join('.')
    
    assert.throws(
      () => extractVerificationMetadata(tokenWithoutIss),
      /missing iss/,
      'Should reject token without issuer'
    )
  })

  it('signature record includes MFA evidence', () => {
    const session: SessionInfo = {
      authenticatedAt: Date.now() - 30000,
      mfaVerified: true,
      principal: {
        iss: 'https://idp.test',
        sub: 'diana',
        name: 'Diana',
      },
      mfaEvidence: {
        acr: 'mfa',
        amr: ['pwd', 'otp'],
        auth_time: Math.floor(Date.now() / 1000) - 60,
      },
    }
    
    const signature = createSignature('content to sign', 'Approved', session)
    
    assert.ok(signature.mfaEvidence, 'Signature should include MFA evidence')
    assert.equal(signature.mfaEvidence?.acr, 'mfa')
    assert.deepEqual(signature.mfaEvidence?.amr, ['pwd', 'otp'])
    assert.ok(signature.mfaEvidence?.auth_time)
  })

  it('signature record includes verification metadata', () => {
    const session: SessionInfo = {
      authenticatedAt: Date.now() - 30000,
      mfaVerified: true,
      principal: {
        iss: 'https://idp.test',
        sub: 'eve',
        name: 'Eve',
      },
      verificationMetadata: {
        jwks_key_id: 'key-2024-01',
        token_verified_at: Date.now() - 60000,
        idp_issuer: 'https://idp.test',
      },
    }
    
    const signature = createSignature('important document', 'Reviewed', session)
    
    assert.ok(signature.verificationMetadata, 'Signature should include verification metadata')
    assert.equal(signature.verificationMetadata?.jwks_key_id, 'key-2024-01')
    assert.equal(signature.verificationMetadata?.idp_issuer, 'https://idp.test')
    assert.ok(signature.verificationMetadata?.token_verified_at)
  })

  it('signature record includes both MFA evidence and verification metadata', () => {
    const session: SessionInfo = {
      authenticatedAt: Date.now() - 30000,
      mfaVerified: true,
      principal: {
        iss: 'https://idp.test',
        sub: 'frank',
        name: 'Frank',
      },
      mfaEvidence: {
        acr: 'urn:mace:incommon:iap:silver',
        amr: ['pwd', 'sms'],
        auth_time: Math.floor(Date.now() / 1000) - 120,
      },
      verificationMetadata: {
        jwks_key_id: 'rsa-key-2024',
        token_verified_at: Date.now() - 120000,
        idp_issuer: 'https://idp.test',
      },
    }
    
    const signature = createSignature('critical approval', 'Approved', session)
    
    // Both evidence types present
    assert.ok(signature.mfaEvidence, 'Should have MFA evidence')
    assert.ok(signature.verificationMetadata, 'Should have verification metadata')
    
    // MFA evidence fields
    assert.equal(signature.mfaEvidence?.acr, 'urn:mace:incommon:iap:silver')
    assert.deepEqual(signature.mfaEvidence?.amr, ['pwd', 'sms'])
    
    // Verification metadata fields
    assert.equal(signature.verificationMetadata?.jwks_key_id, 'rsa-key-2024')
    assert.equal(signature.verificationMetadata?.idp_issuer, 'https://idp.test')
  })

  it('signature without evidence fields still valid (backward compatible)', () => {
    const session: SessionInfo = {
      authenticatedAt: Date.now() - 30000,
      mfaVerified: true,
      principal: {
        iss: 'https://idp.test',
        sub: 'grace',
        name: 'Grace',
      },
      // No mfaEvidence or verificationMetadata
    }
    
    const signature = createSignature('legacy document', 'Authored', session)
    
    assert.ok(signature.hash, 'Signature should be valid')
    assert.ok(signature.principal)
    assert.equal(signature.mfaEvidence, undefined, 'Optional fields can be absent')
    assert.equal(signature.verificationMetadata, undefined)
  })
})
