/**
 * Tests for IdP baseline drift detection (Ticket 23)
 */

import '../../db/testSchema.js'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { getDb } from '../../db/database.js'
import { idpBaseline, idpDriftReports } from '../../db/schema.js'
import {
  establishBaseline,
  getCurrentBaseline,
  detectDrift,
  isSigningBlockedByDrift,
  type IdpBaselineConfig,
  type IdpCurrentConfig,
} from './idpDriftDetection.js'

describe('IdP Baseline Drift Detection (Ticket 23)', () => {
  beforeEach(async () => {
    // Clean slate
    await getDb().delete(idpDriftReports)
    await getDb().delete(idpBaseline)
  })

  describe('Baseline Management', () => {
    it('establishes a new baseline', async () => {
      const baseline = await establishBaseline('admin@example.com', {
        mfaClaimsAvailable: { acr: 'urn:se:curity:authentication:html-form:mfa', amr: ['mfa', 'otp'] },
        requiredScopes: ['openid', 'profile', 'email'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
      })

      assert.ok(baseline.id, 'Baseline should have ID')
      assert.equal(baseline.establishedBy, 'admin@example.com')
      assert.equal(baseline.isCurrent, true)
      assert.equal(baseline.signatureAlgorithm, 'RS256')
    })

    it('marks previous baseline as not current when establishing new one', async () => {
      const baseline1 = await establishBaseline('admin1@example.com', {
        mfaClaimsAvailable: { amr: ['mfa'] },
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
      })

      const baseline2 = await establishBaseline('admin2@example.com', {
        mfaClaimsAvailable: { amr: ['mfa', 'otp'] },
        requiredScopes: ['openid', 'profile'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
      })

      const current = await getCurrentBaseline()
      assert.equal(current!.id, baseline2.id, 'Latest baseline should be current')
      assert.equal(current!.isCurrent, true)

      // Check baseline1 is no longer current
      const allBaselines = await getDb().select().from(idpBaseline)
      const oldBaseline = allBaselines.find(b => b.id === baseline1.id)
      assert.equal(oldBaseline!.isCurrent, false, 'Old baseline should not be current')
    })

    it('returns null when no baseline exists', async () => {
      const baseline = await getCurrentBaseline()
      assert.equal(baseline, null)
    })
  })

  describe('Drift Detection', () => {
    it('detects critical drift: MFA claims missing', () => {
      const baseline: IdpBaselineConfig = {
        id: 1,
        establishedAt: new Date(),
        establishedBy: 'admin@example.com',
        mfaClaimsAvailable: { amr: ['mfa', 'otp'] },
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
        isCurrent: true,
      }

      const current: IdpCurrentConfig = {
        // MFA claims missing
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
      }

      const { criticalDrifts, nonCriticalDrifts } = detectDrift(baseline, current)

      assert.equal(criticalDrifts.length, 1)
      assert.ok(criticalDrifts[0].includes('MFA claims no longer available'))
      assert.equal(nonCriticalDrifts.length, 0)
    })

    it('detects critical drift: MFA amr values empty', () => {
      const baseline: IdpBaselineConfig = {
        id: 1,
        establishedAt: new Date(),
        establishedBy: 'admin@example.com',
        mfaClaimsAvailable: { amr: ['mfa', 'otp'] },
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
        isCurrent: true,
      }

      const current: IdpCurrentConfig = {
        mfaClaimsAvailable: { amr: [] }, // Empty amr
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
      }

      const { criticalDrifts } = detectDrift(baseline, current)

      assert.equal(criticalDrifts.length, 1)
      assert.ok(criticalDrifts[0].includes('amr claim values no longer populated'))
    })

    it('detects critical drift: signature algorithm changed', () => {
      const baseline: IdpBaselineConfig = {
        id: 1,
        establishedAt: new Date(),
        establishedBy: 'admin@example.com',
        mfaClaimsAvailable: { amr: ['mfa'] },
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
        isCurrent: true,
      }

      const current: IdpCurrentConfig = {
        mfaClaimsAvailable: { amr: ['mfa'] },
        requiredScopes: ['openid'],
        signatureAlgorithm: 'HS256', // Changed!
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
      }

      const { criticalDrifts } = detectDrift(baseline, current)

      assert.equal(criticalDrifts.length, 1)
      assert.ok(criticalDrifts[0].includes('RS256 → HS256'))
    })

    it('detects critical drift: issuer changed', () => {
      const baseline: IdpBaselineConfig = {
        id: 1,
        establishedAt: new Date(),
        establishedBy: 'admin@example.com',
        mfaClaimsAvailable: { amr: ['mfa'] },
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
        isCurrent: true,
      }

      const current: IdpCurrentConfig = {
        mfaClaimsAvailable: { amr: ['mfa'] },
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
        issuer: 'http://idp.example.com', // Changed!
      }

      const { criticalDrifts } = detectDrift(baseline, current)

      assert.equal(criticalDrifts.length, 1)
      assert.ok(criticalDrifts[0].includes('Issuer changed'))
    })

    it('detects non-critical drift: group claim format changed', () => {
      const baseline: IdpBaselineConfig = {
        id: 1,
        establishedAt: new Date(),
        establishedBy: 'admin@example.com',
        mfaClaimsAvailable: { amr: ['mfa'] },
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
        isCurrent: true,
      }

      const current: IdpCurrentConfig = {
        mfaClaimsAvailable: { amr: ['mfa'] },
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'overage', // Changed!
        issuer: 'http://localhost:8180/realms/mice',
      }

      const { criticalDrifts, nonCriticalDrifts } = detectDrift(baseline, current)

      assert.equal(criticalDrifts.length, 0)
      assert.equal(nonCriticalDrifts.length, 1)
      assert.ok(nonCriticalDrifts[0].includes('Group claim format changed'))
    })

    it('detects non-critical drift: scopes expanded', () => {
      const baseline: IdpBaselineConfig = {
        id: 1,
        establishedAt: new Date(),
        establishedBy: 'admin@example.com',
        mfaClaimsAvailable: { amr: ['mfa'] },
        requiredScopes: ['openid', 'profile'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
        isCurrent: true,
      }

      const current: IdpCurrentConfig = {
        mfaClaimsAvailable: { amr: ['mfa'] },
        requiredScopes: ['openid', 'profile', 'email', 'phone'], // Added scopes
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
      }

      const { criticalDrifts, nonCriticalDrifts } = detectDrift(baseline, current)

      assert.equal(criticalDrifts.length, 0)
      assert.equal(nonCriticalDrifts.length, 1)
      assert.ok(nonCriticalDrifts[0].includes('email, phone'))
    })

    it('detects no drift when configs match', () => {
      const baseline: IdpBaselineConfig = {
        id: 1,
        establishedAt: new Date(),
        establishedBy: 'admin@example.com',
        mfaClaimsAvailable: { amr: ['mfa', 'otp'] },
        requiredScopes: ['openid', 'profile'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
        isCurrent: true,
      }

      const current: IdpCurrentConfig = {
        mfaClaimsAvailable: { amr: ['mfa', 'otp'] },
        requiredScopes: ['openid', 'profile'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
      }

      const { criticalDrifts, nonCriticalDrifts } = detectDrift(baseline, current)

      assert.equal(criticalDrifts.length, 0)
      assert.equal(nonCriticalDrifts.length, 0)
    })

    it('detects multiple critical drifts', () => {
      const baseline: IdpBaselineConfig = {
        id: 1,
        establishedAt: new Date(),
        establishedBy: 'admin@example.com',
        mfaClaimsAvailable: { amr: ['mfa'] },
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
        isCurrent: true,
      }

      const current: IdpCurrentConfig = {
        // MFA missing
        requiredScopes: ['openid'],
        signatureAlgorithm: 'HS256', // Algorithm changed
        groupClaimFormat: 'array',
        issuer: 'http://new-idp.example.com', // Issuer changed
      }

      const { criticalDrifts } = detectDrift(baseline, current)

      assert.equal(criticalDrifts.length, 3)
    })
  })

  describe('Signing Block', () => {
    it('blocks signing when critical drift detected recently', async () => {
      // Establish baseline
      const baseline = await establishBaseline('admin@example.com', {
        mfaClaimsAvailable: { amr: ['mfa'] },
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
      })

      // Create drift report with critical drift
      await getDb().insert(idpDriftReports).values({
        checkedAt: new Date(),
        baselineId: baseline.id,
        hasCriticalDrift: true,
        hasNonCriticalDrift: false,
        criticalDrifts: ['MFA claims missing'],
        nonCriticalDrifts: [],
        currentConfig: {
          requiredScopes: ['openid'],
          signatureAlgorithm: 'RS256',
          groupClaimFormat: 'array',
          issuer: 'http://localhost:8180/realms/mice',
        },
      })

      const result = await isSigningBlockedByDrift()

      assert.equal(result.blocked, true)
      assert.ok(result.reason?.includes('MFA claims missing'))
      assert.ok(result.reportId)
    })

    it('does not block signing when no critical drift', async () => {
      // Establish baseline
      const baseline = await establishBaseline('admin@example.com', {
        mfaClaimsAvailable: { amr: ['mfa'] },
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
      })

      // Create drift report with NO critical drift
      await getDb().insert(idpDriftReports).values({
        checkedAt: new Date(),
        baselineId: baseline.id,
        hasCriticalDrift: false,
        hasNonCriticalDrift: true,
        criticalDrifts: [],
        nonCriticalDrifts: ['Group format changed'],
        currentConfig: {
          requiredScopes: ['openid'],
          signatureAlgorithm: 'RS256',
          groupClaimFormat: 'overage',
          issuer: 'http://localhost:8180/realms/mice',
        },
      })

      const result = await isSigningBlockedByDrift()

      assert.equal(result.blocked, false)
    })

    it('does not block signing when drift report is old (>25 hours)', async () => {
      // Establish baseline
      const baseline = await establishBaseline('admin@example.com', {
        mfaClaimsAvailable: { amr: ['mfa'] },
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
      })

      // Create old drift report (26 hours ago)
      const oldDate = new Date(Date.now() - 26 * 60 * 60 * 1000)
      await getDb().insert(idpDriftReports).values({
        checkedAt: oldDate,
        baselineId: baseline.id,
        hasCriticalDrift: true,
        hasNonCriticalDrift: false,
        criticalDrifts: ['MFA claims missing'],
        nonCriticalDrifts: [],
        currentConfig: {
          requiredScopes: ['openid'],
          signatureAlgorithm: 'RS256',
          groupClaimFormat: 'array',
          issuer: 'http://localhost:8180/realms/mice',
        },
      })

      const result = await isSigningBlockedByDrift()

      assert.equal(result.blocked, false)
    })
  })
})
