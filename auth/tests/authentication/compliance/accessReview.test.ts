import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  accessReviewAdminView,
  buildPrincipalAccessRecord,
  displayedAccessReview,
  generateAccessReviewReport,
  openOrGenerateAccessReview,
  signAccessReviewReport,
  validateReportSignature,
  type AccessReviewReport,
  type PrincipalAccessRecord,
} from '../../../src/packages/authentication/lib/compliance/accessReview.js'
import { prepareForSigning, type SignatureRecord } from '../../../src/packages/authentication/lib/signing/signingCeremony.js'

/**
 * Quarterly access review report.
 * A named reviewer signs the report.
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

  describe('buildPrincipalAccessRecord', () => {
    it('lists instance role, namespace seats, grants, and last login', () => {
      const row = buildPrincipalAccessRecord({
        iss: 'https://idp.example.com',
        sub: 'alice',
        name: '  Alice  ',
        lastLoginAt: new Date('2026-01-15T00:00:00.000Z'),
        instanceRole: 'admin',
        namespaceRoles: [
          ['mice', 'owner'],
          ['labs', 'member'],
        ],
        grants: ['create_namespace'],
      })
      assert.deepEqual(row.principal, {
        iss: 'https://idp.example.com',
        sub: 'alice',
        name: 'Alice',
      })
      assert.deepEqual(row.roles, ['instance:admin', 'mice:owner', 'labs:member'])
      assert.deepEqual(row.grants, ['create_namespace'])
      assert.equal(row.lastLogin, Date.parse('2026-01-15T00:00:00.000Z'))
    })

    it('falls back to Unknown and omits empty instance role / last login', () => {
      const row = buildPrincipalAccessRecord({
        iss: 'https://idp.example.com',
        sub: 'anon',
        name: null,
        instanceRole: null,
        namespaceRoles: [],
        grants: [],
      })
      assert.equal(row.principal.name, 'Unknown')
      assert.deepEqual(row.roles, [])
      assert.equal(row.lastLogin, undefined)
    })
  })

  describe('accessReviewAdminView', () => {
    it('pairs the report with the content hash an admin sees before signing', () => {
      const report = generateAccessReviewReport(
        [
          {
            principal: { iss: 'https://idp.example.com', sub: 'alice', name: 'Alice' },
            roles: ['ns:admin'],
            grants: [],
            lastLogin: 1_700_000_000_000,
          },
        ],
        '2026-Q1',
        () => 1_700_000_000_000,
      )
      const view = accessReviewAdminView(report)
      assert.equal(view.report, report)
      assert.equal(
        view.contentHash,
        prepareForSigning(displayedAccessReview(report)).hash,
      )
    })
  })

  describe('openOrGenerateAccessReview', () => {
    const alice: PrincipalAccessRecord = {
      principal: { iss: 'https://idp.example.com', sub: 'alice', name: 'Alice' },
      roles: ['ns:admin'],
      grants: ['instance:admins:add'],
      lastLogin: 1_700_000_000_000,
    }

    it('generates and stores when the quarter is empty', async () => {
      let stored: AccessReviewReport | null = null
      const result = await openOrGenerateAccessReview('2026-Q1', {
        now: () => 1_700_000_000_000,
        findStored: async () => stored,
        collectPrincipals: async () => [alice],
        store: async (_q, report) => {
          stored = report
        },
      })
      assert.equal(result.outcome, 'generated')
      assert.equal(result.report.quarter, '2026-Q1')
      assert.equal(result.report.principals.length, 1)
      assert.equal(result.report.principals[0].lastLogin, 1_700_000_000_000)
      assert.ok(stored)
    })

    it('returns the stored report and does not collect again', async () => {
      const existing = generateAccessReviewReport([alice], '2026-Q1', () => 1_700_000_000_000)
      let collected = 0
      let storeCalls = 0
      const result = await openOrGenerateAccessReview('2026-Q1', {
        findStored: async () => existing,
        collectPrincipals: async () => {
          collected += 1
          return [{ ...alice, principal: { ...alice.principal, sub: 'latecomer', name: 'Late' } }]
        },
        store: async () => {
          storeCalls += 1
        },
      })
      assert.equal(result.outcome, 'read')
      assert.equal(result.report.reportId, existing.reportId)
      assert.equal(collected, 0)
      assert.equal(storeCalls, 0)
      assert.equal(result.report.principals.some((p) => p.principal.sub === 'latecomer'), false)
    })
  })
})
