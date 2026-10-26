import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateTraceabilityMatrix,
  validateRequirementCoverage,
  createRiskAssessment,
  generateIQEvidence,
  generateOQEvidence,
  checkClockDrift,
  generateClockDriftAlert,
  type RequirementTestMapping,
} from './validation.js'

/**
 * TICKET 13: Validation Pack and Clock Drift Alert
 * 
 * Requirements:
 * - Requirement-to-test traceability matrix (map every req to tests)
 * - Risk assessment documentation
 * - IQ/OQ evidence package for regulated customers
 * - Revalidation trigger documentation
 * - Clock drift detection: alert when server clock drifts >1 second
 */

describe('Traceability Matrix', () => {
  it('maps requirements to test cases', () => {
    const mappings: RequirementTestMapping[] = [
      {
        requirementId: 'REQ-001',
        requirementDescription: 'User authentication',
        testCases: ['test-auth-001', 'test-auth-002'],
      },
    ]
    const matrix = generateTraceabilityMatrix(mappings)
    assert.equal(matrix.mappings.length, 1)
    assert.equal(matrix.mappings[0].testCases.length, 2)
  })

  it('ensures every requirement has at least one test', () => {
    const mappings: RequirementTestMapping[] = [
      {
        requirementId: 'REQ-001',
        requirementDescription: 'Has tests',
        testCases: ['test-001'],
      },
      {
        requirementId: 'REQ-002',
        requirementDescription: 'No tests',
        testCases: [],
      },
    ]
    const matrix = generateTraceabilityMatrix(mappings)
    assert.throws(
      () => validateRequirementCoverage(matrix),
      /REQ-002/
    )
  })

  it('generates matrix in machine-readable format', () => {
    const mappings: RequirementTestMapping[] = [
      {
        requirementId: 'REQ-001',
        requirementDescription: 'Test',
        testCases: ['test-001'],
      },
    ]
    const matrix = generateTraceabilityMatrix(mappings)
    assert.ok(matrix.generatedAt > 0)
    assert.ok(matrix.coverage)
    assert.equal(matrix.coverage.coveragePercentage, 100)
  })
})

describe('Risk Assessment', () => {
  it('documents identified risks', () => {
    const risk = createRiskAssessment(
      'RISK-001',
      'Unauthorized access',
      'high',
      'Implement MFA'
    )
    assert.equal(risk.riskId, 'RISK-001')
    assert.equal(risk.description, 'Unauthorized access')
  })

  it('includes risk mitigation strategies', () => {
    const risk = createRiskAssessment(
      'RISK-002',
      'Data breach',
      'critical',
      'Encrypt all data at rest'
    )
    assert.equal(risk.mitigation, 'Encrypt all data at rest')
    assert.equal(risk.severity, 'critical')
  })
})

describe('IQ/OQ Evidence Package', () => {
  it('generates installation qualification evidence', () => {
    const iq = generateIQEvidence('Auth Service', '1.0.0', 'Admin')
    assert.equal(iq.component, 'Auth Service')
    assert.equal(iq.version, '1.0.0')
    assert.equal(iq.verifiedBy, 'Admin')
    assert.ok(iq.installedAt > 0)
  })

  it('generates operational qualification evidence', () => {
    const oq = generateOQEvidence('OQ-001', 'Login flow test', 'pass', 'QA Engineer')
    assert.equal(oq.testId, 'OQ-001')
    assert.equal(oq.result, 'pass')
    assert.equal(oq.verifiedBy, 'QA Engineer')
    assert.ok(oq.executedAt > 0)
  })
})

describe('Clock Drift Detection', () => {
  it('detects clock drift >1 second', () => {
    const referenceTime = Date.now()
    const driftedTime = referenceTime + 2000 // 2 seconds drift
    const check = checkClockDrift(referenceTime, driftedTime)
    assert.equal(check.withinThreshold, false)
    assert.ok(check.driftMs > 1000)
  })

  it('allows clock drift ≤1 second', () => {
    const referenceTime = Date.now()
    const driftedTime = referenceTime + 500 // 0.5 seconds drift
    const check = checkClockDrift(referenceTime, driftedTime)
    assert.ok(check.withinThreshold)
    assert.ok(check.driftMs <= 1000)
  })

  it('generates alert when drift exceeds threshold', () => {
    const referenceTime = Date.now()
    const driftedTime = referenceTime + 3000 // 3 seconds drift
    const check = checkClockDrift(referenceTime, driftedTime)
    const alert = generateClockDriftAlert(check)
    assert.ok(alert)
    assert.ok(alert!.message.includes('drift detected'))
    assert.ok(alert!.driftMs > 1000)
  })
})
