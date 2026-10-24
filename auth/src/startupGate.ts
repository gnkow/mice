const DEV_SESSION_SECRET = 'dev-only-change-me-mice-session-secret'
const SHIPPED_CLIENT_SECRET = 'mice-auth-secret'

/** Returns the reasons a production deployment must not start; empty outside production. */
export function productionStartupProblems(
  e: Record<string, string | undefined>,
): string[] {
  if (e.NODE_ENV !== 'production') return []
  const problems: string[] = []
  if (!e.SESSION_SECRET || e.SESSION_SECRET === DEV_SESSION_SECRET) {
    problems.push('SESSION_SECRET must be set to a private value (missing or dev default)')
  }
  if (e.OIDC_CLIENT_SECRET === SHIPPED_CLIENT_SECRET) {
    problems.push('OIDC_CLIENT_SECRET is the shipped demo secret "mice-auth-secret"')
  }
  if (e.COOKIE_SECURE !== 'true') {
    problems.push('COOKIE_SECURE must be "true" so Session cookies are Secure')
  }
  return problems
}

export function assertProductionStartup(
  e: Record<string, string | undefined> = process.env,
): void {
  const problems = productionStartupProblems(e)
  if (problems.length) {
    throw new Error(`Refusing to start in production:\n- ${problems.join('\n- ')}`)
  }
}
