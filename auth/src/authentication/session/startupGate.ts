import { accessSync, constants, mkdirSync } from 'node:fs'

const DEV_SESSION_SECRET = 'dev-only-change-me-mice-session-secret'
const SHIPPED_CLIENT_SECRET = 'mice-auth-secret'

const INTERNAL_SUFFIXES = ['.internal', '.local', '.svc', '.svc.cluster.local', '.localhost']

function isInternalHost(host: string): boolean {
  if (host === 'localhost' || host === '::1' || host === '[::1]') return true
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number) as [number, number]
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  if (!host.includes('.')) return true
  return INTERNAL_SUFFIXES.some((s) => host.endsWith(s))
}

function oxenUpstreamProblem(raw: string): string | null {
  try {
    const host = new URL(raw).hostname.toLowerCase()
    if (isInternalHost(host)) return null
  } catch {
    /* fall through */
  }
  return `OXEN_UPSTREAM "${raw}" must be an internal address (oxen-server has no auth of its own)`
}

const MAX_IDLE_SEC = 900
const MAX_ABSOLUTE_SEC = 8 * 60 * 60

/** Returns the reasons the deployment must not start (production hardening, GxP-strict). */
export function productionStartupProblems(
  e: Record<string, string | undefined>,
): string[] {
  const problems: string[] = []
  const idle = Number(e.SESSION_IDLE_SEC ?? 0)
  if (!(idle > 0)) {
    problems.push('SESSION_IDLE_SEC must be greater than 0 (idle timeout is off)')
  } else if (idle > MAX_IDLE_SEC) {
    problems.push(`SESSION_IDLE_SEC must be at most ${MAX_IDLE_SEC} (15 minutes)`)
  }
  if (e.SESSION_TTL_SEC !== undefined) {
    const ttl = Number(e.SESSION_TTL_SEC)
    if (!(ttl > 0 && ttl <= MAX_ABSOLUTE_SEC)) {
      problems.push(`SESSION_TTL_SEC must be between 1 and ${MAX_ABSOLUTE_SEC} (8 hours)`)
    }
  }
  if (e.NODE_ENV !== 'production') return problems
  if (!e.SESSION_SECRET || e.SESSION_SECRET === DEV_SESSION_SECRET) {
    problems.push('SESSION_SECRET must be set to a private value (missing or dev default)')
  }
  if (e.OIDC_CLIENT_SECRET === SHIPPED_CLIENT_SECRET) {
    problems.push('OIDC_CLIENT_SECRET is the shipped demo secret "mice-auth-secret"')
  }
  if (e.COOKIE_SECURE !== 'true') {
    problems.push('COOKIE_SECURE must be "true" so Session cookies are Secure')
  }
  if (!/^https:\/\//i.test(e.OIDC_ISSUER ?? '')) {
    problems.push('OIDC_ISSUER must be an https:// URL')
  }
  const bootstrapAdmins = (e.AUTHZ_BOOTSTRAP_ADMINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (bootstrapAdmins.length === 0) {
    problems.push('AUTHZ_BOOTSTRAP_ADMINS must list at least one instance admin')
  }
  if (e.AUTH_DEV_MODE === 'true') {
    problems.push('AUTH_DEV_MODE must not be set in production')
  }
  const upstreamProblem = oxenUpstreamProblem(e.OXEN_UPSTREAM ?? 'http://127.0.0.1:3001')
  if (upstreamProblem) problems.push(upstreamProblem)
  const dataDir = e.AUTH_DATA_DIR ?? './data'
  try {
    mkdirSync(dataDir, { recursive: true })
    accessSync(dataDir, constants.W_OK)
  } catch {
    problems.push(`AUTH_DATA_DIR "${dataDir}" is not writable`)
  }
  return problems
}

export function assertProductionStartup(
  e: Record<string, string | undefined> = process.env,
): void {
  const problems = productionStartupProblems(e)
  if (problems.length) {
    throw new Error(`Refusing to start:\n- ${problems.join('\n- ')}`)
  }
}
