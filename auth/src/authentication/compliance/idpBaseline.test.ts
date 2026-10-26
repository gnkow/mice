import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkIdpBaseline,
  detectDrift,
  recordIdpOutage,
  type IdpBaselineRequirements,
  type IdpPrincipalState,
  type MicePrincipalState,
} from './idpBaseline.js'

/**
 * TICKET 11: IdP Baseline and Drift Reports
 * 
 * Requirements:
 * - Baseline check: Prove IdP meets regulatory requirements
 * - Run baseline check at every deploy + daily scheduled
 * - Daily drift report comparing IdP state vs Mice state
 * - Alarm when Principal has signing rights but is IdP-disabled
 * - IdP outage recorded as incident
 */

describe('IdP Baseline Check', () => {
  it('checks MFA is enabled on IdP', () => {
    const requirements: IdpBaselineRequirements = {
      mfaEnabled: true,
      accountLockoutConfigured: true,
      passwordPolicyConfigured: true,
    }
    const result = checkIdpBaseline(requirements)
    assert.ok(result.passed)
    assert.equal(result.errors.length, 0)
  })

  it('checks account lockout policy configured', () => {
    const requirements: IdpBaselineRequirements = {
      mfaEnabled: true,
      accountLockoutConfigured: true,
      passwordPolicyConfigured: true,
    }
    const result = checkIdpBaseline(requirements)
    assert.ok(result.requirements.accountLockoutConfigured)
  })

  it('checks password policy meets requirements', () => {
    const requirements: IdpBaselineRequirements = {
      mfaEnabled: true,
      accountLockoutConfigured: true,
      passwordPolicyConfigured: true,
    }
    const result = checkIdpBaseline(requirements)
    assert.ok(result.requirements.passwordPolicyConfigured)
  })

  it('fails baseline if MFA not enabled', () => {
    const requirements: IdpBaselineRequirements = {
      mfaEnabled: false,
      accountLockoutConfigured: true,
      passwordPolicyConfigured: true,
    }
    const result = checkIdpBaseline(requirements)
    assert.equal(result.passed, false)
    assert.ok(result.errors.some(e => e.includes('MFA')))
  })
})

describe('IdP Drift Detection', () => {
  it('compares IdP state vs Mice state', () => {
    const idpPrincipals: IdpPrincipalState[] = [
      { principal: { iss: 'https://idp.example.com', sub: 'alice' }, enabled: true, mfaEnrolled: true },
    ]
    const micePrincipals: MicePrincipalState[] = [
      { principal: { iss: 'https://idp.example.com', sub: 'alice' }, active: true, hasSigningRights: false },
    ]
    const report = detectDrift(idpPrincipals, micePrincipals)
    assert.ok(report.timestamp > 0)
    assert.ok(Array.isArray(report.drifts))
  })

  it('detects when Principal is disabled in IdP but active in Mice', () => {
    const idpPrincipals: IdpPrincipalState[] = [
      { principal: { iss: 'https://idp.example.com', sub: 'bob' }, enabled: false, mfaEnrolled: true },
    ]
    const micePrincipals: MicePrincipalState[] = [
      { principal: { iss: 'https://idp.example.com', sub: 'bob' }, active: true, hasSigningRights: false },
    ]
    const report = detectDrift(idpPrincipals, micePrincipals)
    assert.equal(report.drifts.length, 1)
    assert.ok(report.drifts[0].description.includes('disabled in IdP'))
  })

  it('alarms when Principal with signing rights is IdP-disabled', () => {
    const idpPrincipals: IdpPrincipalState[] = [
      { principal: { iss: 'https://idp.example.com', sub: 'charlie' }, enabled: false, mfaEnrolled: true },
    ]
    const micePrincipals: MicePrincipalState[] = [
      { principal: { iss: 'https://idp.example.com', sub: 'charlie' }, active: true, hasSigningRights: true },
    ]
    const report = detectDrift(idpPrincipals, micePrincipals)
    assert.ok(report.criticalAlarms.length > 0)
    assert.ok(report.criticalAlarms[0].includes('CRITICAL'))
    assert.ok(report.criticalAlarms[0].includes('signing rights'))
  })
})

describe('IdP Outage Tracking', () => {
  it('records IdP outage as incident', () => {
    const startTime = Date.now()
    const incident = recordIdpOutage(startTime, undefined, ['login', 'token refresh'])
    assert.equal(incident.severity, 'critical')
    assert.equal(incident.startTime, startTime)
  })

  it('includes outage duration in incident', () => {
    const startTime = Date.now()
    const endTime = startTime + 5000
    const incident = recordIdpOutage(startTime, endTime, ['login'])
    assert.equal(incident.duration, 5000)
  })

  it('includes affected operations in incident', () => {
    const startTime = Date.now()
    const affectedOps = ['login', 'token refresh', 'MFA verification']
    const incident = recordIdpOutage(startTime, undefined, affectedOps)
    assert.deepEqual(incident.affectedOperations, affectedOps)
  })
})
