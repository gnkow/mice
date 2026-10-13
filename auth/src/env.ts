function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (v === undefined || v === '') {
    throw new Error(`Missing required env ${name}`)
  }
  return v
}

export const env = {
  port: Number(process.env.PORT ?? 8080),
  oxenUpstream: required('OXEN_UPSTREAM', 'http://127.0.0.1:3001').replace(
    /\/$/,
    '',
  ),
  sessionSecret: required(
    'SESSION_SECRET',
    'dev-only-change-me-boxen-session-secret',
  ),
  /** Cookie max age (seconds). */
  sessionTtlSec: Number(process.env.SESSION_TTL_SEC ?? 60 * 60 * 8),
  cookieName: process.env.SESSION_COOKIE_NAME ?? 'boxen_session',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  authDevMode: process.env.AUTH_DEV_MODE === 'true',
  /** Optional Bearer that grants proxy access without a session (automation). */
  breakglassToken: process.env.AUTH_BREAKGLASS_TOKEN ?? '',
  /** Directory for PAT store (pats.json). */
  dataDir: (process.env.AUTH_DATA_DIR ?? './data').replace(/\/$/, ''),
  /** Public base URL clients use for oxen CLI (scheme+host+port, no path). */
  publicOxenRemote:
    process.env.PUBLIC_OXEN_REMOTE?.replace(/\/$/, '') ??
    `http://localhost:${process.env.AUTH_PORT ?? process.env.PORT ?? 8080}`,
  oidcIssuer: process.env.OIDC_ISSUER ?? '',
  /** Issuer URL as seen by the browser (Keycloak published hostname). */
  oidcIssuerPublic: process.env.OIDC_ISSUER_PUBLIC ?? process.env.OIDC_ISSUER ?? '',
  oidcClientId: process.env.OIDC_CLIENT_ID ?? '',
  oidcClientSecret: process.env.OIDC_CLIENT_SECRET ?? '',
  oidcRedirectUri: process.env.OIDC_REDIRECT_URI ?? '',
  /** Browser return URL after IdP end-session (must be allow-listed on the client). */
  oidcPostLogoutRedirectUri:
    process.env.OIDC_POST_LOGOUT_REDIRECT_URI ??
    process.env.OIDC_REDIRECT_URI?.replace(/\/auth\/callback$/, '/login') ??
    'http://localhost:5173/login',
  /** Default author when AUTH_DEV_MODE login is used. */
  devUser: {
    sub: process.env.AUTH_DEV_SUB ?? 'dev-user',
    iss: process.env.AUTH_DEV_ISS ?? 'boxen-dev',
    email: process.env.AUTH_DEV_EMAIL ?? 'dev@boxen.local',
    name: process.env.AUTH_DEV_NAME ?? 'Boxen Dev',
  },
}

export function oidcConfigured(): boolean {
  return Boolean(
    env.oidcIssuer &&
      env.oidcClientId &&
      env.oidcRedirectUri,
  )
}
