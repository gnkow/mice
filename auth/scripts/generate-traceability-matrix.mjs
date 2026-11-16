#!/usr/bin/env node
/**
 * Scan auth test files for GXP-R-* ids in test names and write the release
 * traceability matrix artifact (GxP ticket 18 / Q26).
 *
 * Usage: node scripts/generate-traceability-matrix.mjs [outPath]
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outPath = process.argv[2] ?? join(root, 'traceability-matrix.json')

const GXP_REQUIREMENT_ID_RE = /\bGXP-R-\d+\b/g
const GXP_REQUIREMENT_CATALOG = {
  'GXP-R-008': 'Authoritative e-signature record in immudb',
  'GXP-R-013': 'Reason policy on regulated mutation classes',
  'GXP-R-014': 'Change-control id on regulated mutations and signatures',
  'GXP-R-026': 'Electronic signature ceremony on regulated mutations',
  'GXP-R-061': 'Backup target configured and reachable at start',
  'GXP-R-063': 'Restore / integrity controls for regulated records',
}

function walk(dir, acc = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist') continue
      walk(p, acc)
    } else if (ent.isFile() && /\.test\.(ts|js|mjs)$/.test(ent.name)) {
      acc.push(p)
    }
  }
  return acc
}

function extractIds(name) {
  return [...new Set(name.match(GXP_REQUIREMENT_ID_RE) ?? [])].sort()
}

function extractTestNames(source) {
  const names = []
  const re = /\b(?:it|test|await\s+it)\(\s*(['"`])([\s\S]*?)\1/g
  let m
  while ((m = re.exec(source))) {
    names.push(m[2].replace(/\s+/g, ' ').trim())
  }
  return names
}

const byId = new Map()
const testNames = []
for (const file of walk(join(root, 'src'))) {
  const source = readFileSync(file, 'utf8')
  for (const name of extractTestNames(source)) {
    testNames.push(name)
    for (const id of extractIds(name)) {
      const list = byId.get(id) ?? []
      list.push(`${relative(root, file)} :: ${name}`)
      byId.set(id, list)
    }
  }
}

const ids = new Set([...Object.keys(GXP_REQUIREMENT_CATALOG), ...byId.keys()])
const mappings = [...ids].sort().map((requirementId) => ({
  requirementId,
  requirementDescription:
    GXP_REQUIREMENT_CATALOG[requirementId] ?? `GxP requirement ${requirementId}`,
  testCases: byId.get(requirementId) ?? [],
}))

const covered = mappings.filter((m) => m.testCases.length > 0).length
const matrix = {
  generatedAt: Date.now(),
  mappings,
  coverage: {
    totalRequirements: mappings.length,
    coveredRequirements: covered,
    coveragePercentage: mappings.length
      ? Math.round((covered / mappings.length) * 100)
      : 0,
  },
  scannedTestNames: testNames.length,
}

const digest = `sha256:${createHash('sha256')
  .update(
    JSON.stringify({
      mappings: matrix.mappings.map((m) => ({
        requirementId: m.requirementId,
        testCases: [...m.testCases].sort(),
      })),
      coverage: matrix.coverage,
    }),
    'utf8',
  )
  .digest('hex')}`

const artifact = { ...matrix, digest }
writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`)
console.log(`Wrote ${outPath} (${covered}/${mappings.length} covered, ${digest})`)
