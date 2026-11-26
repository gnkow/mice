import { eq } from 'drizzle-orm'
import { getDb } from '../../../../db/database.js'
import { accessReviewReports, principals } from '../../../../db/schema.js'
import { instancePermissions } from '../../../authz/index.js'
import { namespaceRolesFor } from '../../../authz/stores.js'
import { getUserRole } from '../../../authz/rbac.js'
import type { PrincipalId } from '../session/principal.js'
import { prepareForSigning, type SignatureRecord } from '../signing/signingCeremony.js'

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

/** Displayed document + hash shared by admin view and the sign gate (Ticket 40). */
export function prepareAccessReviewDocument(report: AccessReviewReport): {
  content: string
  contentHash: string
} {
  const content = displayedAccessReview(report)
  return { content, contentHash: prepareForSigning(content).hash }
}

/** Admin GET/generate response shape: stored report + hash of the displayed document. */
export function accessReviewAdminView(report: AccessReviewReport): {
  report: AccessReviewReport
  contentHash: string
} {
  return {
    report,
    contentHash: prepareAccessReviewDocument(report).contentHash,
  }
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

/**
 * Pure assembly of one Principal row for the quarterly report.
 * Instance role (when present) is listed as `instance:<role>`; namespace seats as `ns:role`.
 */
export function buildPrincipalAccessRecord(input: {
  iss: string
  sub: string
  name: string | null
  lastLoginAt?: Date | null
  instanceRole?: string | null
  namespaceRoles: Iterable<[string, string]>
  grants: string[]
}): PrincipalAccessRecord {
  const roles: string[] = []
  const instanceRole = input.instanceRole?.trim()
  if (instanceRole) roles.push(`instance:${instanceRole}`)
  for (const [ns, role] of input.namespaceRoles) {
    roles.push(`${ns}:${role}`)
  }
  return {
    principal: {
      iss: input.iss,
      sub: input.sub,
      name: input.name?.trim() || 'Unknown',
    },
    roles,
    grants: [...input.grants],
    ...(input.lastLoginAt ? { lastLogin: input.lastLoginAt.getTime() } : {}),
  }
}

/** Assemble every Principal with roles, instance grants, and last login. */
export async function collectPrincipalAccessRecords(): Promise<PrincipalAccessRecord[]> {
  const allPrincipals = await getDb().select().from(principals)
  return Promise.all(
    allPrincipals.map(async (p) => {
      const principal = { iss: p.iss, sub: p.sub }
      const [perms, roles, instanceRole] = await Promise.all([
        instancePermissions(principal),
        namespaceRolesFor(principal),
        getUserRole(principal),
      ])
      return buildPrincipalAccessRecord({
        iss: p.iss,
        sub: p.sub,
        name: p.name,
        lastLoginAt: p.lastLoginAt,
        instanceRole,
        namespaceRoles: [...roles.entries()]
          .filter(([, role]) => role != null)
          .map(([ns, role]) => [ns, role as string] as [string, string]),
        grants: perms,
      })
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
