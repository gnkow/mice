import { eq } from 'drizzle-orm'
import { getDb } from '../../db/database.js'
import { accessReviewReports, principals } from '../../db/schema.js'
import { instancePermissions } from '../../authzInstanceStore.js'
import { namespaceRolesFor } from '../../authzMembershipStore.js'
import type { PrincipalId } from '../session/principal.js'
import type { SignatureRecord } from '../signing/signingCeremony.js'

/**
 * Quarterly access review report.
 */

export interface PrincipalAccessRecord {
  principal: PrincipalId & { name: string }
  roles: string[]
  grants: string[]
  lastLogin?: number
}

export interface AccessReviewReport {
  reportId: string
  quarter: string
  generatedAt: number
  principals: PrincipalAccessRecord[]
  reviewerSignature?: SignatureRecord
}

export type AccessReviewOutcome =
  | { outcome: 'read'; report: AccessReviewReport }
  | { outcome: 'generated'; report: AccessReviewReport }

export type AccessReviewDeps = {
  now?: () => number
  findStored?: (quarter: string) => Promise<AccessReviewReport | null>
  collectPrincipals?: () => Promise<PrincipalAccessRecord[]>
  store?: (quarter: string, report: AccessReviewReport) => Promise<void>
}

/**
 * Generate a quarterly access review report.
 */
export function generateAccessReviewReport(
  principals: PrincipalAccessRecord[],
  quarter: string,
  now: () => number = Date.now,
): AccessReviewReport {
  const at = now()
  return {
    reportId: `access-review-${quarter}-${at}`,
    quarter,
    generatedAt: at,
    principals,
  }
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

/** The exact document a reviewer is shown. The signature hash is of this string. */
export function displayedAccessReview(report: AccessReviewReport): string {
  const displayed = { ...report }
  delete displayed.reviewerSignature
  return JSON.stringify(sorted(displayed))
}

/**
 * Sign an access review report.
 */
export function signAccessReviewReport(
  report: AccessReviewReport,
  signature: SignatureRecord,
): AccessReviewReport {
  return {
    ...report,
    reviewerSignature: signature,
  }
}

/**
 * Validate that a reviewer has signed the report.
 */
export function validateReportSignature(report: AccessReviewReport): void {
  if (!report.reviewerSignature) {
    throw new Error('Access review report must be signed by named reviewer')
  }
}

async function defaultFindStored(quarter: string): Promise<AccessReviewReport | null> {
  const [stored] = await getDb()
    .select()
    .from(accessReviewReports)
    .where(eq(accessReviewReports.quarter, quarter))
    .limit(1)
  return stored?.report ?? null
}

/** Assemble every Principal with namespace roles, instance grants, and last login. */
export async function collectPrincipalAccessRecords(): Promise<PrincipalAccessRecord[]> {
  const allPrincipals = await getDb().select().from(principals)
  return Promise.all(
    allPrincipals.map(async (p) => {
      const principal = { iss: p.iss, sub: p.sub, name: p.name || 'Unknown' }
      const perms = await instancePermissions(principal)
      const roles = await namespaceRolesFor(principal)
      const rolesList = Array.from(roles.entries()).map(([ns, role]) => `${ns}:${role}`)
      return {
        principal,
        roles: rolesList,
        grants: perms,
        ...(p.lastLoginAt ? { lastLogin: p.lastLoginAt.getTime() } : {}),
      }
    }),
  )
}

async function defaultStore(quarter: string, report: AccessReviewReport): Promise<void> {
  await getDb().insert(accessReviewReports).values({
    quarter,
    report,
    createdAt: new Date(report.generatedAt),
  })
}

/**
 * Open the stored quarterly report, or generate and store it once.
 * A second call for the same quarter returns the stored document (no late Principals).
 */
export async function openOrGenerateAccessReview(
  quarter: string,
  deps: AccessReviewDeps = {},
): Promise<AccessReviewOutcome> {
  const findStored = deps.findStored ?? defaultFindStored
  const collectPrincipals = deps.collectPrincipals ?? collectPrincipalAccessRecords
  const store = deps.store ?? defaultStore
  const now = deps.now ?? Date.now

  const existing = await findStored(quarter)
  if (existing) return { outcome: 'read', report: existing }

  const report = generateAccessReviewReport(await collectPrincipals(), quarter, now)
  await store(quarter, report)
  return { outcome: 'generated', report }
}

/** Load a previously generated report, or null when none exists. */
export async function getStoredAccessReview(quarter: string): Promise<AccessReviewReport | null> {
  return defaultFindStored(quarter)
}

/** Persist a signed report over the stored quarter row. */
export async function saveSignedAccessReview(
  quarter: string,
  report: AccessReviewReport,
): Promise<void> {
  await getDb()
    .update(accessReviewReports)
    .set({ report })
    .where(eq(accessReviewReports.quarter, quarter))
}
