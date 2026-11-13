import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  extractMfaEvidence,
  evaluateIdpMfaBaseline,
  type MfaEvidence,
} from './mfaEvidence.js'

/**
 * MFA Evidence Extraction Tests
 * 
 * Part 11 §11.200 requires "two distinct identification components" at signing.
 * These tests verify correct extraction of MFA evidence (acr, amr) from IdP claims.
 * 
 * Related:
 * - Round 8 decision U1: IdP MFA capability is a deployment prerequisite
 * - Round 8 decision U19: Signature records store both claims AND verification metadata
 * - .scratch/authentication/issues/14-idp-mfa-baseline-validation.md
 */

describe('MFA Evidence Extraction', () => {
  it('extracts acr and amr claims from id_token payload', () => {
    const payload = {
      sub: 'alice',
      iss: 'https://idp.example.com',
      acr: 'mfa',
      amr: ['pwd', 'otp'],
      auth_time: 1234567890,
    }

    const evidence = extractMfaEvidence(payload)

    assert.equal(evidence.hasMfa, true)
    assert.equal(evidence.acr, 'mfa')
    assert.deepEqual(evidence.amr, ['pwd', 'otp'])
    assert.equal(evidence.authTime, 1234567890)
  })

  it('detects password-only authentication (no MFA)', () => {
    const payload = {
      sub: 'bob',
      iss: 'https://idp.example.com',
      acr: 'password',
      amr: ['pwd'],
      auth_time: 1234567890,
    }

    const evidence = extractMfaEvidence(payload)

    assert.equal(evidence.hasMfa, false)
    assert.equal(evidence.acr, 'password')
    assert.deepEqual(evidence.amr, ['pwd'])
  })

  it('returns no MFA when acr claim is missing', () => {
    const payload = {
      sub: 'charlie',
      iss: 'https://idp.example.com',
      auth_time: 1234567890,
    }

    const evidence = extractMfaEvidence(payload)

    assert.equal(evidence.hasMfa, false)
    assert.equal(evidence.acr, undefined)
    assert.deepEqual(evidence.amr, [])
  })

  it('returns no MFA when amr claim is missing', () => {
    const payload = {
      sub: 'dana',
      iss: 'https://idp.example.com',
      acr: 'mfa',
      auth_time: 1234567890,
    }

    const evidence = extractMfaEvidence(payload)

    assert.equal(evidence.hasMfa, false)
    assert.equal(evidence.acr, 'mfa')
    assert.deepEqual(evidence.amr, [])
  })

  it('detects MFA from multiple authentication methods in amr', () => {
    const payload = {
      sub: 'eve',
      iss: 'https://idp.example.com',
      acr: '2',
      amr: ['pwd', 'sms', 'mfa'],
      auth_time: 1234567890,
    }

    const evidence = extractMfaEvidence(payload)

    assert.equal(evidence.hasMfa, true)
    assert.deepEqual(evidence.amr, ['pwd', 'sms', 'mfa'])
  })

  it('handles non-standard amr values (hardware token, biometric)', () => {
    const payload = {
      sub: 'frank',
      iss: 'https://idp.example.com',
      acr: 'mfa',
      amr: ['pwd', 'hwk'], // hwk = hardware key
      auth_time: 1234567890,
    }

    const evidence = extractMfaEvidence(payload)

    assert.equal(evidence.hasMfa, true)
    assert.deepEqual(evidence.amr, ['pwd', 'hwk'])
  })

  it('handles amr as a single string (not array)', () => {
    // Single method string -> normalized to array but still single method, no MFA
    const singleMethod = {
      sub: 'grace',
      iss: 'https://idp.example.com',
      acr: 'mfa',
      amr: 'pwd',
      auth_time: 1234567890,
    }

    const evidence = extractMfaEvidence(singleMethod)

    assert.equal(evidence.hasMfa, false)
    assert.deepEqual(evidence.amr, ['pwd'])

    // Single string with MFA indicator -> MFA
    const mfaIndicator = {
      acr: 'mfa',
      amr: 'otp',
      auth_time: 123,
    }

    const evidenceMfa = extractMfaEvidence(mfaIndicator)
    assert.equal(evidenceMfa.hasMfa, true)
    assert.deepEqual(evidenceMfa.amr, ['otp'])
  })
})

describe('MFA Evidence - hasMfa Logic', () => {
  it('requires both acr and amr to determine MFA', () => {
    // acr present, amr present, multiple methods -> MFA
    const withBoth = extractMfaEvidence({
      acr: 'mfa',
      amr: ['pwd', 'otp'],
      auth_time: 123,
    })
    assert.equal(withBoth.hasMfa, true)

    // acr only -> no MFA
    const acrOnly = extractMfaEvidence({
      acr: 'mfa',
      auth_time: 123,
    })
    assert.equal(acrOnly.hasMfa, false)

    // amr only -> no MFA
    const amrOnly = extractMfaEvidence({
      amr: ['pwd', 'otp'],
      auth_time: 123,
    })
    assert.equal(amrOnly.hasMfa, false)
  })

  it('requires multiple authentication methods in amr for MFA', () => {
    // Single method (password only) -> no MFA
    const singleMethod = extractMfaEvidence({
      acr: 'mfa',
      amr: ['pwd'],
      auth_time: 123,
    })
    assert.equal(singleMethod.hasMfa, false)

    // Multiple methods -> MFA
    const multiMethod = extractMfaEvidence({
      acr: 'mfa',
      amr: ['pwd', 'otp'],
      auth_time: 123,
    })
    assert.equal(multiMethod.hasMfa, true)
  })

  it('recognizes standard MFA indicators in amr', () => {
    const mfaIndicators = ['otp', 'sms', 'hwk', 'mfa', 'swk', 'tel', 'fpt']

    for (const indicator of mfaIndicators) {
      const evidence = extractMfaEvidence({
        acr: '2',
        amr: ['pwd', indicator],
        auth_time: 123,
      })
      assert.equal(evidence.hasMfa, true, `Should detect MFA with indicator: ${indicator}`)
    }
  })
})

describe('IdP MFA baseline evaluation', () => {
  it('records MFA available with claims when acr/amr qualify', () => {
    const result = evaluateIdpMfaBaseline({
      acr: 'mfa',
      amr: ['pwd', 'otp'],
      auth_time: 1_700_000_000,
    })
    assert.equal(result.mfaAvailable, true)
    assert.equal(result.error, null)
    assert.deepEqual(result.claimsFound, {
      acr: 'mfa',
      amr: ['pwd', 'otp'],
      authTime: 1_700_000_000,
    })
  })

  it('records MFA unavailable when claims are weak or missing', () => {
    const weak = evaluateIdpMfaBaseline({ acr: 'password', amr: ['pwd'] })
    assert.equal(weak.mfaAvailable, false)
    assert.match(weak.error ?? '', /MFA/)
    assert.deepEqual(weak.claimsFound, { acr: 'password', amr: ['pwd'] })

    const absent = evaluateIdpMfaBaseline(null)
    assert.equal(absent.mfaAvailable, false)
    assert.equal(absent.claimsFound, null)
    assert.match(absent.error ?? '', /id_token|claims/i)
  })
})
