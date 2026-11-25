import { EMPTY_AUDIT_CHANGE } from './auditChange.js'
import { createHash } from 'node:crypto'
import { appendAudit } from './audit.js'
import {
  generateTraceabilityMatrix,
  type RequirementTestMapping,
  type TraceabilityMatrix,
} from './authentication/compliance/validation.js'

/** GxP requirement id token embedded in test names (ticket 18 / Q26). */
export const GXP_REQUIREMENT_ID_RE = /\bGXP-R-\d+\b/g

/**
 * Catalog of GxP requirement ids referenced by tagged tests.
 * Descriptions stay short; the QMS owns the full requirement text.
 */
export const GXP_REQUIREMENT_CATALOG: Readonly<Record<string, string>> = {
  'GXP-R-008': 'Authoritative e-signature record in immudb',
  'GXP-R-013': 'Reason policy on regulated mutation classes',
  'GXP-R-014': 'Change-control id on regulated mutations and signatures',
  'GXP-R-026': 'Electronic signature ceremony on regulated mutations',
  'GXP-R-061': 'Backup target configured and reachable at start',
  'GXP-R-063': 'Restore / integrity controls for regulated records',
}

export function extractGxpRequirementIds(testName: string): string[] {
  const found = testName.match(GXP_REQUIREMENT_ID_RE) ?? []
  return [...new Set(found)].sort()
}

/**
 * Build a release traceability matrix from test names that embed GXP-R-* ids.
 * Untagged names are ignored. Catalog entries with no tests still appear when
 * `includeUncoveredCatalog` is true (default) so gaps are visible.
 */
export function buildTraceabilityMatrixFromTestNames(
  testNames: string[],
  opts?: { includeUncoveredCatalog?: boolean; now?: number },
): TraceabilityMatrix {
  const byId = new Map<string, string[]>()
  for (const name of testNames) {
    for (const id of extractGxpRequirementIds(name)) {
      const list = byId.get(id) ?? []
      list.push(name)
      byId.set(id, list)
    }
  }

  const includeUncovered = opts?.includeUncoveredCatalog !== false
  const ids = new Set<string>([...byId.keys()])
  if (includeUncovered) {
    for (const id of Object.keys(GXP_REQUIREMENT_CATALOG)) ids.add(id)
  }

  const mappings: RequirementTestMapping[] = [...ids]
    .sort()
    .map((requirementId) => ({
      requirementId,
      requirementDescription:
        GXP_REQUIREMENT_CATALOG[requirementId] ?? `GxP requirement ${requirementId}`,
      testCases: byId.get(requirementId) ?? [],
    }))

  const matrix = generateTraceabilityMatrix(mappings)
  if (opts?.now !== undefined) {
    return { ...matrix, generatedAt: opts.now }
  }
  return matrix
}

export function traceabilityMatrixDigest(matrix: TraceabilityMatrix): string {
  const canonical = JSON.stringify({
    mappings: matrix.mappings.map((m) => ({
      requirementId: m.requirementId,
      testCases: [...m.testCases].sort(),
    })),
    coverage: matrix.coverage,
  })
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`
}

/**
 * Append the release matrix to the audit trail (alongside the signed release manifest).
 */
export async function recordTraceabilityMatrixRelease(
  matrix: TraceabilityMatrix,
): Promise<{ digest: string }> {
  const digest = traceabilityMatrixDigest(matrix)
  await appendAudit({
    actor: { sub: 'system', iss: 'mice', email: 'system@mice', name: 'Mice' },
    via: 'system',
    method: 'SYSTEM',
    path: '/boot',
    action: 'system.traceability_matrix.release',
    change: EMPTY_AUDIT_CHANGE,
    status: 200,
    message: `Traceability matrix release artifact (${matrix.coverage.coveredRequirements}/${matrix.coverage.totalRequirements} covered)`,
    detail: {
      digest,
      coveragePercentage: matrix.coverage.coveragePercentage,
      coveredRequirements: matrix.coverage.coveredRequirements,
      totalRequirements: matrix.coverage.totalRequirements,
      requirementIds: matrix.mappings.map((m) => m.requirementId),
    },
  })
  return { digest }
}
