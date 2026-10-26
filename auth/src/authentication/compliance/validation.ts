/**
 * TICKET 13: Validation Pack and Clock Drift Alert
 * 
 * Provides compliance documentation and system monitoring.
 */

export interface RequirementTestMapping {
  requirementId: string
  requirementDescription: string
  testCases: string[]
}

export interface TraceabilityMatrix {
  generatedAt: number
  mappings: RequirementTestMapping[]
  coverage: {
    totalRequirements: number
    coveredRequirements: number
    coveragePercentage: number
  }
}

export interface RiskAssessment {
  riskId: string
  description: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  mitigation: string
}

export interface IQEvidence {
  component: string
  version: string
  installedAt: number
  verifiedBy: string
}

export interface OQEvidence {
  testId: string
  testDescription: string
  executedAt: number
  result: 'pass' | 'fail'
  verifiedBy: string
}

export interface ValidationPackage {
  traceabilityMatrix: TraceabilityMatrix
  riskAssessments: RiskAssessment[]
  iqEvidence: IQEvidence[]
  oqEvidence: OQEvidence[]
  generatedAt: number
}

export interface ClockDriftCheck {
  referenceTime: number
  systemTime: number
  driftMs: number
  thresholdMs: number
  withinThreshold: boolean
}

export interface ClockDriftAlert {
  alertId: string
  detectedAt: number
  driftMs: number
  severity: 'warning' | 'critical'
  message: string
}

const CLOCK_DRIFT_THRESHOLD_MS = 1000 // 1 second

/**
 * Generate a traceability matrix mapping requirements to tests.
 */
export function generateTraceabilityMatrix(
  mappings: RequirementTestMapping[]
): TraceabilityMatrix {
  const coveredRequirements = mappings.filter(m => m.testCases.length > 0).length
  const totalRequirements = mappings.length
  
  return {
    generatedAt: Date.now(),
    mappings,
    coverage: {
      totalRequirements,
      coveredRequirements,
      coveragePercentage: totalRequirements > 0 
        ? Math.round((coveredRequirements / totalRequirements) * 100)
        : 0,
    },
  }
}

/**
 * Validate that all requirements have test coverage.
 */
export function validateRequirementCoverage(matrix: TraceabilityMatrix): void {
  const uncovered = matrix.mappings.filter(m => m.testCases.length === 0)
  if (uncovered.length > 0) {
    throw new Error(
      `${uncovered.length} requirements have no test coverage: ${uncovered.map(r => r.requirementId).join(', ')}`
    )
  }
}

/**
 * Create a risk assessment entry.
 */
export function createRiskAssessment(
  riskId: string,
  description: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  mitigation: string,
): RiskAssessment {
  return { riskId, description, severity, mitigation }
}

/**
 * Generate installation qualification evidence.
 */
export function generateIQEvidence(
  component: string,
  version: string,
  verifiedBy: string,
): IQEvidence {
  return {
    component,
    version,
    installedAt: Date.now(),
    verifiedBy,
  }
}

/**
 * Generate operational qualification evidence.
 */
export function generateOQEvidence(
  testId: string,
  testDescription: string,
  result: 'pass' | 'fail',
  verifiedBy: string,
): OQEvidence {
  return {
    testId,
    testDescription,
    executedAt: Date.now(),
    result,
    verifiedBy,
  }
}

/**
 * Check for clock drift against a reference time.
 */
export function checkClockDrift(
  referenceTime: number,
  systemTime: number = Date.now(),
): ClockDriftCheck {
  const driftMs = Math.abs(systemTime - referenceTime)
  
  return {
    referenceTime,
    systemTime,
    driftMs,
    thresholdMs: CLOCK_DRIFT_THRESHOLD_MS,
    withinThreshold: driftMs <= CLOCK_DRIFT_THRESHOLD_MS,
  }
}

/**
 * Generate an alert if clock drift exceeds threshold.
 */
export function generateClockDriftAlert(check: ClockDriftCheck): ClockDriftAlert | null {
  if (check.withinThreshold) {
    return null
  }
  
  return {
    alertId: `clock-drift-${Date.now()}`,
    detectedAt: Date.now(),
    driftMs: check.driftMs,
    severity: check.driftMs > 5000 ? 'critical' : 'warning',
    message: `Clock drift detected: ${check.driftMs}ms exceeds threshold of ${check.thresholdMs}ms`,
  }
}
