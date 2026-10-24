import { SERVICE_ISSUER } from './principal.js'

const DEV_SESSION_SECRET = 'dev-only-change-me-mice-session-secret'
const SHIPPED_CLIENT_SECRET = 'mice-auth-secret'

/** Returns the reasons the deployment must not start (production hardening, GxP-strict). */
export function productionStartupProblems(
  e: Record<string, string | undefined>,
): string[] {
  const problems: string[] = []
  if (e.GXP_STRICT === 'true' && !(Number(e.SESSION_IDLE_SEC ?? 0) > 0)) {
    problems.push('SESSION_IDLE_SEC must be greater than 0 when GXP_STRICT=true (idle timeout is off)')
  }
  if ((e.OIDC_ISSUER ?? '').trim().replace(/\/$/, '') === SERVICE_ISSUER) {
    problems.push(`OIDC_ISSUER must not be the reserved service issuer "${SERVICE_ISSUER}"`)
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
