/**
 * Tests for IdP baseline drift detection (Ticket 23)
 */

import '../../db/testSchema.js'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { getDb } from '../../db/database.js'
import { idpBaseline, idpDriftReports } from '../../db/schema.js'
import { overrideEnv } from '../../env.js'
import {
  assessDrift,
  establishBaseline,
  getCurrentBaseline,
  detectDrift,
  getCurrentIdpConfig,
  issuersEquivalent,
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
    it('does not treat unmeasured MFA (discovery-only) as drift', () => {
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
        // Discovery never sets mfaClaimsAvailable
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        signatureAlgorithmsSupported: ['RS256'],
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
      }

      const { criticalDrifts, nonCriticalDrifts } = detectDrift(baseline, current)

      assert.equal(criticalDrifts.length, 0)
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

    it('detects critical drift: auth_time no longer asserted', () => {
      const baseline: IdpBaselineConfig = {
        id: 1,
        establishedAt: new Date(),
        establishedBy: 'admin@example.com',
        mfaClaimsAvailable: { amr: ['mfa', 'otp'], authTimeAsserted: true },
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
        isCurrent: true,
      }

      const current: IdpCurrentConfig = {
        mfaClaimsAvailable: { amr: ['mfa', 'otp'] },
        authTimeAsserted: false,
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
      }

      const { criticalDrifts } = detectDrift(baseline, current)

      assert.equal(criticalDrifts.length, 1)
      assert.ok(criticalDrifts[0].includes('auth_time'))
    })

    it('detects critical drift: signature algorithm no longer supported', () => {
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
        signatureAlgorithm: 'HS256',
        signatureAlgorithmsSupported: ['HS256'],
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
      }

      const { criticalDrifts } = detectDrift(baseline, current)

      assert.equal(criticalDrifts.length, 1)
      assert.ok(criticalDrifts[0].includes('no longer supported'))
    })

    it('ignores preferred-alg order when baseline alg remains supported', () => {
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
        requiredScopes: ['openid'],
        signatureAlgorithm: 'PS384',
        signatureAlgorithmsSupported: ['PS384', 'RS256'],
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
      }

      const { criticalDrifts } = detectDrift(baseline, current)
      assert.equal(criticalDrifts.length, 0)
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
        signatureAlgorithmsSupported: ['RS256'],
        groupClaimFormat: 'array',
        issuer: 'http://idp.example.com', // Changed!
      }

      const { criticalDrifts } = detectDrift(baseline, current)

      assert.equal(criticalDrifts.length, 1)
      assert.ok(criticalDrifts[0].includes('Issuer changed'))
    })

    it('treats Compose Keycloak host variants as the same issuer', () => {
      assert.equal(
        issuersEquivalent(
          'http://keycloak:8080/realms/mice',
          'http://localhost:8080/realms/mice',
        ),
        true,
      )
      assert.equal(
        issuersEquivalent(
          'http://keycloak:8080/realms/mice',
          'http://localhost:8180/realms/mice',
        ),
        true,
      )
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
        mfaClaimsAvailable: { amr: [] },
        requiredScopes: ['openid'],
        signatureAlgorithm: 'HS256',
        signatureAlgorithmsSupported: ['HS256'],
        groupClaimFormat: 'array',
        issuer: 'http://new-idp.example.com',
      }

      const { criticalDrifts } = detectDrift(baseline, current)

      assert.equal(criticalDrifts.length, 3)
    })
  })

  describe('Current IdP config', () => {
    const withDiscovery = async (doc: Record<string, unknown>) => {
      return getCurrentIdpConfig({
        fetchDiscovery: async () => doc as never,
        issuer: () => 'http://idp.test',
      })
    }
    const base = { issuer: 'http://idp.test', id_token_signing_alg_values_supported: ['RS256'] }

    it('reports auth_time as asserted when discovery advertises it', async () => {
      const cfg = await withDiscovery({ ...base, claims_supported: ['sub', 'acr', 'amr', 'auth_time'] })
      assert.equal(cfg.authTimeAsserted, true)
    })

    it('reports auth_time as not asserted when discovery omits it', async () => {
      const cfg = await withDiscovery({ ...base, claims_supported: ['sub', 'acr', 'amr'] })
      assert.equal(cfg.authTimeAsserted, false)
    })
  })

  describe('assessDrift', () => {
    const discovery = {
      issuer: 'http://localhost:8180/realms/mice',
      scopes_supported: ['openid', 'profile'],
      id_token_signing_alg_values_supported: ['RS256'],
      claims_supported: ['sub', 'auth_time'],
    }

    it('compares without storing when persist is false', async () => {
      const restore = overrideEnv({
        oidcIssuer: discovery.issuer,
        oidcIssuerPublic: discovery.issuer,
      })
      try {
        await establishBaseline('admin@example.com', {
          mfaClaimsAvailable: { amr: ['mfa'], authTimeAsserted: true },
          requiredScopes: ['openid'],
          signatureAlgorithm: 'RS256',
          groupClaimFormat: 'array',
        })
        const result = await assessDrift({
          persist: false,
          fetchDiscovery: async () => discovery,
          issuer: () => discovery.issuer,
        })
        // Discovery cannot measure MFA claims; matching issuer/alg/auth_time → no critical drift.
        assert.equal(result.hasCriticalDrift, false)
        const rows = await getDb().select().from(idpDriftReports)
        assert.equal(rows.length, 0)
        assert.equal(result.id, undefined)
      } finally {
        restore()
      }
    })

    it('stores a report when persist is true', async () => {
      const restore = overrideEnv({
        oidcIssuer: discovery.issuer,
        oidcIssuerPublic: discovery.issuer,
      })
      try {
        await establishBaseline('admin@example.com', {
          mfaClaimsAvailable: { amr: ['mfa'] },
          requiredScopes: ['openid'],
          signatureAlgorithm: 'RS256',
          groupClaimFormat: 'array',
        })
        const result = await assessDrift({
          persist: true,
          fetchDiscovery: async () => discovery,
          issuer: () => discovery.issuer,
        })
        assert.ok(result.id)
        const rows = await getDb().select().from(idpDriftReports)
        assert.equal(rows.length, 1)
        assert.equal(rows[0].id, result.id)
      } finally {
        restore()
      }
    })
  })

  describe('runIdpDriftTick', () => {
    it('persists drift and returns access alarm count', async () => {
      const issuer = 'http://localhost:8180/realms/mice'
      const restore = overrideEnv({ oidcIssuer: issuer, oidcIssuerPublic: issuer })
      try {
        const { runIdpDriftTick } = await import('./idpDriftSchedule.js')
        await establishBaseline('admin@example.com', {
          mfaClaimsAvailable: { amr: ['mfa'] },
          requiredScopes: ['openid'],
          signatureAlgorithm: 'RS256',
          groupClaimFormat: 'array',
        })
        const result = await runIdpDriftTick({
          fetchDiscovery: async () => ({
            issuer,
            scopes_supported: ['openid'],
            id_token_signing_alg_values_supported: ['RS256'],
          }),
          issuer: () => issuer,
          runAccessCheck: async () => ({ alarmsFound: 2 }),
        })
        assert.ok(result.report.id)
        assert.equal(result.accessAlarmsFound, 2)
        const rows = await getDb().select().from(idpDriftReports)
        assert.equal(rows.length, 1)
      } finally {
        restore()
      }
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

    it('clears the block when a newer clean check supersedes a critical report', async () => {
      const baseline = await establishBaseline('admin@example.com', {
        mfaClaimsAvailable: { amr: ['mfa'] },
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
      })

      const config = {
        requiredScopes: ['openid'],
        signatureAlgorithm: 'RS256',
        groupClaimFormat: 'array',
        issuer: 'http://localhost:8180/realms/mice',
      }
      await getDb().insert(idpDriftReports).values({
        checkedAt: new Date(Date.now() - 60_000),
        baselineId: baseline.id,
        hasCriticalDrift: true,
        hasNonCriticalDrift: false,
        criticalDrifts: ['MFA claims missing'],
        nonCriticalDrifts: [],
        currentConfig: config,
      })
      await getDb().insert(idpDriftReports).values({
        checkedAt: new Date(),
        baselineId: baseline.id,
        hasCriticalDrift: false,
        hasNonCriticalDrift: false,
        criticalDrifts: [],
        nonCriticalDrifts: [],
        currentConfig: config,
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
