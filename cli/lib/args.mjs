/**
 * Parse argv into flags and positionals.
 * Supports `--key value`, `--key=value`, and boolean `--key`.
 * Everything after `--` goes to `_.`
 */
export function parseArgs(argv) {
  const out = { _: [], flags: {} }
  let i = 0
  while (i < argv.length) {
    const a = argv[i]
    if (a === '--') {
      out._.push(...argv.slice(i + 1))
      break
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 2) {
        out.flags[a.slice(2, eq)] = a.slice(eq + 1)
        i += 1
        continue
      }
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next == null || next.startsWith('--')) {
        out.flags[key] = true
        i += 1
      } else {
        out.flags[key] = next
        i += 2
      }
      continue
    }
    out._.push(a)
    i += 1
  }
  return out
}

export function requireFlag(flags, name, usage) {
  const v = flags[name]
  if (v == null || v === true || v === '') {
    console.error(`Missing --${name}`)
    usage(1)
  }
  return String(v)
}

const SCOPE_ROLES = ['read', 'triage', 'write', 'maintain', 'admin']

/** `ns[/repo]:role` -> PAT scope, or null. */
export function parseScope(text) {
  const m = /^([A-Za-z0-9][\w.-]*)(?:\/([A-Za-z0-9][\w.-]*))?:([a-z]+)$/.exec(text.trim())
  if (!m || !SCOPE_ROLES.includes(m[3])) return null
  return { namespace: m[1], ...(m[2] ? { repo: m[2] } : {}), maxRole: m[3] }
}
