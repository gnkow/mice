/**
 * IdP Baseline Drift Detection (Ticket 23, U20)
 * 
 * Daily automated check compares current IdP configuration against stored baseline.
 * Critical drift (MFA missing, algorithm changed) blocks signing.
 * Non-critical drift (group format changed) alerts only.
 */

import { getDb } from '../../db/database.js'
import { idpBaseline, idpDriftReports } from '../../db/schema.js'
import { eq, desc } from 'drizzle-orm'
import { env } from '../../env.js'
import { extractMfaEvidence } from '../signing/mfaEvidence.js'

export type IdpBaselineConfig = {
  id: number
  establishedAt: Date
  establishedBy: string
  mfaClaimsAvailable: { acr?: string; amr: string[]; authTimeAsserted?: boolean }
  requiredScopes: string[]
  signatureAlgorithm: string
  groupClaimFormat: string
  issuer: string
  isCurrent: boolean
}

export type IdpCurrentConfig = {
  mfaClaimsAvailable?: { acr?: string; amr: string[] }
  /** From discovery `claims_supported`; undefined when the IdP does not publish the list. */
  authTimeAsserted?: boolean
  requiredScopes: string[]
  signatureAlgorithm: string
  groupClaimFormat: string
  issuer: string
}

export type DriftReport = {
  id?: number
  checkedAt?: Date
  baselineId: number
  hasCriticalDrift: boolean
  hasNonCriticalDrift: boolean
  criticalDrifts: string[]
  nonCriticalDrifts: string[]
  currentConfig: IdpCurrentConfig
  error?: string
}

/**
 * Get the current active baseline configuration.
 */
export async function getCurrentBaseline(): Promise<IdpBaselineConfig | null> {
  const [row] = await getDb()
    .select()
    .from(idpBaseline)
    .where(eq(idpBaseline.isCurrent, true))
    .orderBy(desc(idpBaseline.establishedAt))
    .limit(1)

  if (!row) return null

  return {
    id: row.id,
    establishedAt: row.establishedAt,
    establishedBy: row.establishedBy,
    mfaClaimsAvailable: row.mfaClaimsAvailable,
    requiredScopes: row.requiredScopes,
    signatureAlgorithm: row.signatureAlgorithm,
    groupClaimFormat: row.groupClaimFormat,
    issuer: row.issuer,
    isCurrent: row.isCurrent,
  }
}

/**
 * Get the current IdP configuration by fetching OIDC discovery and test login.
 */
export async function getCurrentIdpConfig(): Promise<IdpCurrentConfig> {
  const issuer = env.oidcIssuer

  // Fetch OIDC discovery
  const discoveryUrl = `${issuer}/.well-known/openid-configuration`
  const discoveryRes = await fetch(discoveryUrl)
  if (!discoveryRes.ok) {
    throw new Error(`Failed to fetch OIDC discovery: ${discoveryRes.status}`)
  }

  const discovery = await discoveryRes.json() as {
    issuer: string
    scopes_supported?: string[]
    id_token_signing_alg_values_supported?: string[]
    claims_supported?: string[]
  }

  // Determine signature algorithm from discovery
  const signatureAlgorithm = discovery.id_token_signing_alg_values_supported?.[0] ?? 'RS256'

  // Determine required scopes from discovery
  const requiredScopes = discovery.scopes_supported ?? ['openid', 'profile', 'email']

  // For MFA claims and group format, we'd need a test login
  // For now, return what we can determine from discovery
  // In production, this would perform a test authentication

  return {
    requiredScopes,
    signatureAlgorithm,
    groupClaimFormat: 'array', // Would be determined from test login
    issuer: discovery.issuer,
    ...(discovery.claims_supported
      ? { authTimeAsserted: discovery.claims_supported.includes('auth_time') }
      : {}),
  }
}

/**
 * Compare baseline vs current config and detect drift.
 */
export function detectDrift(
  baseline: IdpBaselineConfig,
  current: IdpCurrentConfig
): { criticalDrifts: string[]; nonCriticalDrifts: string[] } {
  const criticalDrifts: string[] = []
  const nonCriticalDrifts: string[] = []

  // Critical: MFA claims missing
  if (baseline.mfaClaimsAvailable && !current.mfaClaimsAvailable) {
    criticalDrifts.push('MFA claims no longer available in id_token')
  } else if (
    baseline.mfaClaimsAvailable &&
    current.mfaClaimsAvailable &&
    baseline.mfaClaimsAvailable.amr.length > 0 &&
    current.mfaClaimsAvailable.amr.length === 0
  ) {
    criticalDrifts.push('MFA amr claim values no longer populated')
  }

  // Critical: signing evidence needs auth_time; a baseline that had it must keep it
  if (baseline.mfaClaimsAvailable?.authTimeAsserted && current.authTimeAsserted === false) {
    criticalDrifts.push('auth_time claim no longer asserted in id_token')
  }

  // Critical: Signature algorithm changed
  if (baseline.signatureAlgorithm !== current.signatureAlgorithm) {
    criticalDrifts.push(
      `Token signature algorithm changed: ${baseline.signatureAlgorithm} → ${current.signatureAlgorithm}`
    )
  }

  // Critical: Issuer changed
  if (baseline.issuer !== current.issuer) {
    criticalDrifts.push(`Issuer changed: ${baseline.issuer} → ${current.issuer}`)
  }

  // Non-critical: Group claim format changed
  if (baseline.groupClaimFormat !== current.groupClaimFormat) {
    nonCriticalDrifts.push(
      `Group claim format changed: ${baseline.groupClaimFormat} → ${current.groupClaimFormat}`
    )
  }

  // Non-critical: Required scopes expanded
  const newScopes = current.requiredScopes.filter(
    (scope) => !baseline.requiredScopes.includes(scope)
  )
  if (newScopes.length > 0) {
    nonCriticalDrifts.push(`New scopes available: ${newScopes.join(', ')}`)
  }

  return { criticalDrifts, nonCriticalDrifts }
}

/**
 * Perform drift detection check and store report.
 */
export async function performDriftCheck(): Promise<DriftReport> {
  const baseline = await getCurrentBaseline()

  if (!baseline) {
    throw new Error('No active baseline configuration found')
  }

  let currentConfig: IdpCurrentConfig
  let error: string | undefined

  try {
    currentConfig = await getCurrentIdpConfig()
  } catch (err) {
    error = err instanceof Error ? err.message : 'Unknown error fetching IdP config'
    // If we can't fetch current config, create a report with error
    const report: DriftReport = {
      baselineId: baseline.id,
      hasCriticalDrift: false,
      hasNonCriticalDrift: false,
      criticalDrifts: [],
      nonCriticalDrifts: [],
      currentConfig: {
        requiredScopes: [],
        signatureAlgorithm: '',
        groupClaimFormat: '',
        issuer: '',
      },
      error,
    }

    // Store report
    const [stored] = await getDb()
      .insert(idpDriftReports)
      .values({
        checkedAt: new Date(),
        baselineId: baseline.id,
        hasCriticalDrift: false,
        hasNonCriticalDrift: false,
        criticalDrifts: [],
        nonCriticalDrifts: [],
        currentConfig: report.currentConfig,
        error,
      })
      .returning()

    return { ...report, id: stored.id, checkedAt: stored.checkedAt }
  }

  // Detect drift
  const { criticalDrifts, nonCriticalDrifts } = detectDrift(baseline, currentConfig)

  const report: DriftReport = {
    baselineId: baseline.id,
    hasCriticalDrift: criticalDrifts.length > 0,
    hasNonCriticalDrift: nonCriticalDrifts.length > 0,
    criticalDrifts,
    nonCriticalDrifts,
    currentConfig,
  }

  // Store report
  const [stored] = await getDb()
    .insert(idpDriftReports)
    .values({
      checkedAt: new Date(),
      baselineId: baseline.id,
      hasCriticalDrift: report.hasCriticalDrift,
      hasNonCriticalDrift: report.hasNonCriticalDrift,
      criticalDrifts: report.criticalDrifts,
      nonCriticalDrifts: report.nonCriticalDrifts,
      currentConfig: report.currentConfig,
      error: undefined,
    })
    .returning()

  return { ...report, id: stored.id, checkedAt: stored.checkedAt }
}

/**
 * Check if signing should be blocked due to critical drift.
 */
export async function isSigningBlockedByDrift(): Promise<{
  blocked: boolean
  reason?: string
  reportId?: number
}> {
  // Get most recent drift report (within last 25 hours)
  const oneDayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000)

  const [latestReport] = await getDb()
    .select()
    .from(idpDriftReports)
    .where(eq(idpDriftReports.hasCriticalDrift, true))
    .orderBy(desc(idpDriftReports.checkedAt))
    .limit(1)

  if (!latestReport) {
    return { blocked: false }
  }

  // Check if report is recent (within last 25 hours)
  if (latestReport.checkedAt < oneDayAgo) {
    return { blocked: false }
  }

  return {
    blocked: true,
    reason: `Critical IdP drift detected: ${latestReport.criticalDrifts?.join('; ')}`,
    reportId: latestReport.id,
  }
}

/**
 * Establish a new baseline configuration.
 */
export async function establishBaseline(
  establishedBy: string,
  config: Omit<IdpCurrentConfig, 'issuer'> & { mfaClaimsAvailable: { acr?: string; amr: string[]; authTimeAsserted?: boolean } }
): Promise<IdpBaselineConfig> {
  const issuer = env.oidcIssuer

  // Mark all existing baselines as not current
  await getDb()
    .update(idpBaseline)
    .set({ isCurrent: false })
    .where(eq(idpBaseline.isCurrent, true))

  // Create new baseline
  const [newBaseline] = await getDb()
    .insert(idpBaseline)
    .values({
      establishedAt: new Date(),
      establishedBy,
      mfaClaimsAvailable: config.mfaClaimsAvailable,
      requiredScopes: config.requiredScopes,
      signatureAlgorithm: config.signatureAlgorithm,
      groupClaimFormat: config.groupClaimFormat,
      issuer,
      isCurrent: true,
    })
    .returning()

  return {
    id: newBaseline.id,
    establishedAt: newBaseline.establishedAt,
    establishedBy: newBaseline.establishedBy,
    mfaClaimsAvailable: newBaseline.mfaClaimsAvailable,
    requiredScopes: newBaseline.requiredScopes,
    signatureAlgorithm: newBaseline.signatureAlgorithm,
    groupClaimFormat: newBaseline.groupClaimFormat,
    issuer: newBaseline.issuer,
    isCurrent: newBaseline.isCurrent,
  }
}

/**
 * Get recent drift reports.
 */
export async function getRecentDriftReports(limit = 10): Promise<DriftReport[]> {
  const reports = await getDb()
    .select()
    .from(idpDriftReports)
    .orderBy(desc(idpDriftReports.checkedAt))
    .limit(limit)

  return reports.map((r) => ({
    id: r.id,
    checkedAt: r.checkedAt,
    baselineId: r.baselineId,
    hasCriticalDrift: r.hasCriticalDrift,
    hasNonCriticalDrift: r.hasNonCriticalDrift,
    criticalDrifts: r.criticalDrifts ?? [],
    nonCriticalDrifts: r.nonCriticalDrifts ?? [],
    currentConfig: r.currentConfig,
    error: r.error ?? undefined,
  }))
}
