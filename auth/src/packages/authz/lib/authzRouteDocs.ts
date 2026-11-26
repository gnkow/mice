/**
 * Pure helpers for docs ↔ enforcement parity (docs/authorization-routes.md).
 * authzRoutesDocs.test.ts is the only caller today; keep parsing here so the
 * contract stays local to one module.
 */

export function markdownSection(doc: string, heading: string): string {
  const start = doc.indexOf(`## ${heading}`)
  if (start < 0) throw new Error(`docs missing "## ${heading}"`)
  const rest = doc.slice(start + 1)
  const next = rest.search(/\n## /)
  return next < 0 ? rest : rest.slice(0, next)
}

export function markdownTableRows(sectionText: string): string[][] {
  return sectionText
    .split('\n')
    .filter((l) => l.startsWith('|') && !/^\|[-| ]+\|$/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim().replaceAll('`', '')))
}

/** Action → min role rows from the "Action Minimum Roles" table (skips header). */
export function documentedActionMinRoles(doc: string): Record<string, string> {
  const rows = markdownTableRows(markdownSection(doc, 'Action Minimum Roles'))
  return Object.fromEntries(rows.slice(1).map(([action, role]) => [action, role]))
}

/** True when Permission Composition documents collaborator SoT (not ns→repo inheritance). */
export function documentsCollaboratorSourceOfTruth(doc: string): boolean {
  const section = markdownSection(doc, 'Permission Composition')
  const claimsNsOwnerAdmin = /Namespace Owner\s*→\s*`?admin`?/i.test(section)
  const namesCollaborators =
    /direct (repository )?collaborator/i.test(section) &&
    /group (repository )?collaborator/i.test(section)
  const deniesNsInheritance =
    /does not grant/i.test(section) || /collaborator seats are the source of truth/i.test(section)
  return !claimsNsOwnerAdmin && namesCollaborators && deniesNsInheritance
}

const ROLE_TOKEN = /^(read|triage|write|maintain|admin)\b/i

/** First repo-role token in a table cell (`admin †` → `admin`). */
export function roleToken(cell: string): string | undefined {
  const m = cell.trim().match(ROLE_TOKEN)
  return m ? m[1]!.toLowerCase() : undefined
}

/**
 * Expand a docs pattern cell into concrete paths for interpretRequest probes.
 * Strips leading method tokens and expands light sugar: `merge(s)`, `PUT/PATCH`.
 */
export function concretePathsFromPattern(pattern: string): string[] {
  let path = pattern.trim()
  // Drop leading METHOD or METHOD/METHOD tokens until we hit a path.
  while (/^[A-Z]+(\/[A-Z]+)*\s+/.test(path)) {
    path = path.replace(/^[A-Z]+(\/[A-Z]+)*\s+/, '')
  }
  // Drop parenthetical notes (" (not complete)"); keep sugar like merge(s).
  path = path.replace(/\s+\([^)]*\)\s*$/, '').trim()
  const paths = new Set<string>()
  const expand = (p: string) => {
    if (p.includes('merge(s)')) {
      expand(p.replace('merge(s)', 'merge'))
      expand(p.replace('merge(s)', 'merges'))
      return
    }
    paths.add(
      p
        .replaceAll(':ns', 'n')
        .replaceAll(':repo', 'r')
        .replaceAll(':branch', 'b')
        .replaceAll(':id', 'i')
        .replaceAll('**', 'x/y'),
    )
  }
  expand(path)
  return [...paths]
}

/** True when repo.create is documented as a namespace gate, not a collaborator write seat. */
export function documentsRepoCreateAsNamespaceGate(doc: string): boolean {
  const section = markdownSection(doc, 'Route Classification Table')
  const row = markdownTableRows(section).find((r) => /POST\s+\/api\/repos\b/.test(r[0] ?? '') && !r[0]!.includes('/:'))
  if (!row) return false
  const joined = row.join(' ').toLowerCase()
  const claimsWriteSeat = /\bmin role\b/.test(joined) && /\bwrite\b/.test(joined) && !/namespace create/.test(joined)
  return /namespace create gate|create_repos|memberscancreaterepos|members can create/i.test(joined) && !claimsWriteSeat
}
