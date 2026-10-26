import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateAccessReviewReport,
  signAccessReviewReport,
  validateReportSignature,
  createRecoveryToken,
  validateRecoveryToken,
  isRecoveryTokenValid,
  type PrincipalAccessRecord,
  type SignatureRecord,
} from './accessReview.js'

/**
 * TICKET 12: Quarterly Access Review and Two-Person Recovery
 * 
 * Requirements:
 * - Quarterly access report listing every Principal, role, grant, last login
 * - Named reviewer signs report electronically
 * - Two-admin recovery: both admins together can issue 1-hour recovery token
 * - No shared credentials ever
 */

describe('Quarterly Access Review', () => {
  it('generates report listing every Principal', () => {
    const principals: PrincipalAccessRecord[] = [
      {
        principal: { iss: 'https://idp.example.com', sub: 'alice', name: 'Alice' },
        roles: ['admin'],
        grants: ['read', 'write'],
        lastLogin: Date.now(),
      },
    ]
    const report = generateAccessReviewReport(principals, 'Q1-2024')
    assert.equal(report.principals.length, 1)
    assert.equal(report.quarter, 'Q1-2024')
  })

  it('includes role information in report', () => {
    const principals: PrincipalAccessRecord[] = [
      {
        principal: { iss: 'https://idp.example.com', sub: 'bob', name: 'Bob' },
        roles: ['developer', 'reviewer'],
        grants: [],
      },
    ]
    const report = generateAccessReviewReport(principals, 'Q1-2024')
    assert.deepEqual(report.principals[0].roles, ['developer', 'reviewer'])
  })

  it('includes grant information in report', () => {
    const principals: PrincipalAccessRecord[] = [
      {
        principal: { iss: 'https://idp.example.com', sub: 'charlie', name: 'Charlie' },
        roles: [],
        grants: ['namespace:read', 'repo:write'],
      },
    ]
    const report = generateAccessReviewReport(principals, 'Q1-2024')
    assert.deepEqual(report.principals[0].grants, ['namespace:read', 'repo:write'])
  })

  it('includes last login time in report', () => {
    const lastLogin = Date.now() - 1000
    const principals: PrincipalAccessRecord[] = [
      {
        principal: { iss: 'https://idp.example.com', sub: 'dave', name: 'Dave' },
        roles: [],
        grants: [],
        lastLogin,
      },
    ]
    const report = generateAccessReviewReport(principals, 'Q1-2024')
    assert.equal(report.principals[0].lastLogin, lastLogin)
  })

  it('requires named reviewer to sign report', () => {
    const report = generateAccessReviewReport([], 'Q1-2024')
    assert.throws(
      () => validateReportSignature(report),
      /must be signed by named reviewer/
    )
  })

  it('captures reviewer signature electronically', () => {
    const report = generateAccessReviewReport([], 'Q1-2024')
    const signature: SignatureRecord = {
      hash: 'abc123',
      principal: { iss: 'https://idp.example.com', sub: 'reviewer', name: 'Reviewer' },
      signedAt: Date.now(),
      meaning: 'Reviewed',
      content: 'report',
    }
    const signedReport = signAccessReviewReport(report, signature)
    assert.deepEqual(signedReport.reviewerSignature, signature)
  })
})

describe('Two-Person Recovery', () => {
  it('requires two admins for recovery token', () => {
    const admin1 = { iss: 'https://idp.example.com', sub: 'admin1', name: 'Admin One' }
    const admin2 = { iss: 'https://idp.example.com', sub: 'admin2', name: 'Admin Two' }
    const token = createRecoveryToken(admin1, admin2, 'Emergency recovery')
    assert.equal(token.issuedBy.length, 2)
    validateRecoveryToken(token) // Should not throw
  })

  it('generates 1-hour recovery token', () => {
    const admin1 = { iss: 'https://idp.example.com', sub: 'admin1', name: 'Admin One' }
    const admin2 = { iss: 'https://idp.example.com', sub: 'admin2', name: 'Admin Two' }
    const token = createRecoveryToken(admin1, admin2, 'Recovery', 3600000)
    const duration = token.expiresAt - token.issuedAt
    assert.equal(duration, 3600000) // 1 hour
    assert.ok(isRecoveryTokenValid(token, token.issuedAt))
  })

  it('rejects recovery with only one admin', () => {
    const admin1 = { iss: 'https://idp.example.com', sub: 'admin1', name: 'Admin' }
    assert.throws(
      () => createRecoveryToken(admin1, admin1, 'Recovery'),
      /two different admins/
    )
  })
})
