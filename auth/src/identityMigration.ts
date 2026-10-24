import { join } from 'node:path'
import { env } from './env.js'
import { isLegacyPrincipalKey, qualifyLegacyKey } from './principal.js'
import { readJsonFile, writeJsonFile } from './jsonStore.js'

type Json = Record<string, any>

const isLegacyKey = isLegacyPrincipalKey

/**
 * One-off rewrite of authz stores from bare `sub` keys to `iss\0sub`, attributing legacy
 * entries to `issuer`. Idempotent: keys that already carry an issuer are left alone, and
 * when both forms exist the issuer-qualified entry wins. Returns the number of keys rewritten.
 */
export function migrateIdentityKeys(issuer: string): number {
  if (!issuer) return 0
  const qualify = (k: string) => qualifyLegacyKey(issuer, k)
  let rewritten = 0

  const rekeyMap = (map: Json | undefined): Json | undefined => {
    if (!map || typeof map !== 'object') return map
    const out: Json = {}
    for (const [k, v] of Object.entries(map)) {
      if (!isLegacyKey(k)) out[k] = v
    }
    for (const [k, v] of Object.entries(map)) {
      if (!isLegacyKey(k)) continue
      rewritten++
      if (!(qualify(k) in out)) out[qualify(k)] = v
    }
    return out
  }
  const rekeyList = (list: unknown): unknown => {
    if (!Array.isArray(list)) return list
    const out = list.map((k) => {
      if (!isLegacyKey(k)) return k
      rewritten++
      return qualify(k)
    })
    return [...new Set(out)]
  }

  const file = (name: string) => join(env.dataDir, name)
  const update = (name: string, fn: (s: Json) => void) => {
    const s = readJsonFile<Json | null>(file(name), null)
    if (!s) return
    const before = rewritten
    fn(s)
    if (rewritten !== before) writeJsonFile(file(name), s)
  }

  update('instance-admins.json', (s) => {
    s.admins = rekeyList(s.admins)
    s.training = rekeyList(s.training)
    s.permissions = rekeyMap(s.permissions)
  })
  update('namespace-members.json', (s) => {
    for (const ns of Object.keys(s.members ?? {})) s.members[ns] = rekeyMap(s.members[ns])
  })
  update('repo-collaborators.json', (s) => {
    for (const r of Object.keys(s.collaborators ?? {})) {
      s.collaborators[r] = rekeyMap(s.collaborators[r])
    }
  })
  update('namespaces.json', (s) => {
    for (const ns of Object.values<Json>(s.namespaces ?? {})) {
      if (isLegacyKey(ns.createdBy)) {
        ns.createdBy = qualify(ns.createdBy)
        rewritten++
      }
    }
  })
  return rewritten
}

export function runIdentityMigration(): void {
  const issuer = (process.env.AUTH_LEGACY_ISSUER ?? env.oidcIssuer).trim()
  const n = migrateIdentityKeys(issuer)
  if (n) console.log(`[mice-auth] migrated ${n} identity key(s) to iss+sub under ${issuer}`)
}
