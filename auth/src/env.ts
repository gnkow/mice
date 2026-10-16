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
  /** Directory for PAT store (pats.json). */
  dataDir: (process.env.AUTH_DATA_DIR ?? './data').replace(/\/$/, ''),
  /** Job JSONL + work/logs (defaults under AUTH_DATA_DIR/jobs). */
  jobsDataDir: (
    process.env.JOBS_DATA_DIR ??
    `${(process.env.AUTH_DATA_DIR ?? './data').replace(/\/$/, '')}/jobs`
  ).replace(/\/$/, ''),
  /** docker | kubernetes */
  jobsRunner: (process.env.JOBS_RUNNER ?? 'docker').toLowerCase() as
    | 'docker'
    | 'kubernetes',
  jobsDockerBin: process.env.JOBS_DOCKER_BIN ?? 'docker',
  jobsDockerSocket: process.env.JOBS_DOCKER_SOCKET ?? '/var/run/docker.sock',
  /**
   * Host path that corresponds to `jobsDataDir` inside the auth container.
   * Required when the Docker runner uses the host engine (socket mount):
   * `docker run -v` must use a host-visible path, not the container path.
   */
  jobsHostDataDir: (process.env.JOBS_HOST_DATA_DIR ?? '').replace(/\/$/, ''),
  jobsDefaultTimeoutSec: Number(process.env.JOBS_DEFAULT_TIMEOUT_SEC ?? 3600),
  jobsDefaultCpu: process.env.JOBS_DEFAULT_CPU ?? '1',
  jobsDefaultMemory: process.env.JOBS_DEFAULT_MEMORY ?? '2g',
  jobsDefaultDisk: process.env.JOBS_DEFAULT_DISK ?? '20g',
  jobsDefaultMaxLogBytes: Number(
    process.env.JOBS_DEFAULT_MAX_LOG_BYTES ?? 10 * 1024 * 1024,
  ),
  /** Comma-separated registry hosts allowed for image pull (empty = any). */
  jobsImagePullAllowlist: (process.env.JOBS_IMAGE_PULL_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  jobsMaxConcurrent: Number(process.env.JOBS_MAX_CONCURRENT ?? 2),
  /** Kubernetes namespace for Job objects when JOBS_RUNNER=kubernetes. */
  jobsK8sNamespace: process.env.JOBS_K8S_NAMESPACE ?? 'boxen-jobs',
  jobsKubectlBin: process.env.JOBS_KUBECTL_BIN ?? 'kubectl',
  /**
   * AuthZ enforcement override: 'true' | 'false' | '' (use store flag).
   * Default empty → store `enforce` (starts false until bootstrap).
   */
  authzEnforce: (process.env.AUTHZ_ENFORCE ?? '').toLowerCase(),
  /** Comma-separated emails or subject IDs for first instance admin. */
  authzBootstrapAdmins: process.env.AUTHZ_BOOTSTRAP_ADMINS ?? '',
  /**
   * When true, grant instance admin to every authenticated user.
   * Useful for local Compose / e2e; keep off in shared environments.
   */
  authzDevGrantAll: process.env.AUTHZ_DEV_GRANT_ALL === 'true',
  /** JSON map for IdP group / email → namespace or instance grants. */
  authzGroupBootstrap: process.env.AUTHZ_GROUP_BOOTSTRAP ?? '',
  /** Phase 3: require training completion before product /api. */
  authzRequireTraining: process.env.AUTHZ_REQUIRE_TRAINING === 'true',
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
  /** Id token claim name for IdP groups (string or string[]). */
  oidcGroupsClaim: process.env.OIDC_GROUPS_CLAIM ?? 'groups',
  /**
   * Directory search backend: `keycloak` | `none`.
   * Empty → keycloak when KEYCLOAK_ADMIN_URL is set, else none (store-only).
   */
  directoryProvider: (() => {
    const raw = (process.env.DIRECTORY_PROVIDER ?? '').toLowerCase()
    if (raw === 'keycloak' || raw === 'none') return raw
    return process.env.KEYCLOAK_ADMIN_URL ? 'keycloak' : 'none'
  })(),
  /** Keycloak base URL for Admin API (no /realms path), e.g. http://keycloak:8080 */
  keycloakAdminUrl: (process.env.KEYCLOAK_ADMIN_URL ?? '').replace(/\/$/, ''),
  keycloakRealm: process.env.KEYCLOAK_REALM ?? 'boxen',
}

export function oidcConfigured(): boolean {
  return Boolean(
    env.oidcIssuer &&
      env.oidcClientId &&
      env.oidcRedirectUri,
  )
}
