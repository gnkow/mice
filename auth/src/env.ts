import { createHash } from 'node:crypto'

function required(src: NodeJS.ProcessEnv, name: string, fallback?: string): string {
  const v = src[name] ?? fallback
  if (v === undefined || v === '') {
    throw new Error(`Missing required env ${name}`)
  }
  return v
}

/** 32-char utf8 key for guacamole-lite (AES-256-CBC). */
function sessionsGuacCryptKey(src: NodeJS.ProcessEnv): string {
  const raw = src.SESSIONS_GUAC_CRYPT_KEY ?? ''
  if (raw.length >= 32) return raw.slice(0, 32)
  return createHash('sha256')
    .update(
      process.env.SESSION_SECRET ?? 'dev-only-change-me-mice-session-secret',
    )
    .digest('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 32)
    .padEnd(32, '0')
}

/** Read configuration from `src`. The process-wide `env` below is `loadEnv(process.env)`. */
export function loadEnv(src: NodeJS.ProcessEnv = process.env) {
  return {
    port: Number(src.PORT ?? 8080),
    oxenUpstream: required(src, 'OXEN_UPSTREAM', 'http://127.0.0.1:3001').replace(
      /\/$/,
      '',
    ),
    sessionSecret: required(
      src,
      'SESSION_SECRET',
      'dev-only-change-me-mice-session-secret',
    ),
    /** Cookie max age (seconds). */
    sessionTtlSec: Number(src.SESSION_TTL_SEC ?? 60 * 60 * 8),
    /** Idle timeout (seconds); 0 disables. Value owned by PLAT-GXP. */
    sessionIdleSec: Number(src.SESSION_IDLE_SEC ?? 0),
    /** Directory-sync interval (seconds); 0 disables the schedule. */
    directorySyncIntervalSec: Number(src.DIRECTORY_SYNC_INTERVAL_SEC ?? 900),
    /** Audit ledger re-verification interval (seconds). */
    auditVerifyIntervalSec: Number(src.AUDIT_VERIFY_INTERVAL_SEC ?? 3600),
    /** Minimum length of a mutation reason (and of a commit message used as one). */
    auditReasonMinLength: Number(src.AUDIT_REASON_MIN_LENGTH ?? 10),
    /** Days before a service principal PAT expires that its owner is notified; 0 disables. */
    servicePatExpiryLeadDays: Number(src.SERVICE_PAT_EXPIRY_LEAD_DAYS ?? 14),
    cookieName: src.SESSION_COOKIE_NAME ?? '__Host-mice_session',
    cookieSecure: src.COOKIE_SECURE === 'true',
    /** Directory for PAT store (pats.json). */
    dataDir: (src.AUTH_DATA_DIR ?? './data').replace(/\/$/, ''),
    /** Job records + work/logs (defaults under AUTH_DATA_DIR/jobs). */
    jobsDataDir: (
      src.JOBS_DATA_DIR ??
      `${(src.AUTH_DATA_DIR ?? './data').replace(/\/$/, '')}/jobs`
    ).replace(/\/$/, ''),
    /** docker | kubernetes */
    jobsRunner: (src.JOBS_RUNNER ?? 'docker').toLowerCase() as
      | 'docker'
      | 'kubernetes',
    jobsDockerBin: src.JOBS_DOCKER_BIN ?? 'docker',
    jobsDockerSocket: src.JOBS_DOCKER_SOCKET ?? '/var/run/docker.sock',
    /**
     * Host path that corresponds to `jobsDataDir` inside the auth container.
     * Required when the Docker runner uses the host engine (socket mount):
     * `docker run -v` must use a host-visible path, not the container path.
     */
    jobsHostDataDir: (src.JOBS_HOST_DATA_DIR ?? '').replace(/\/$/, ''),
    jobsDefaultTimeoutSec: Number(src.JOBS_DEFAULT_TIMEOUT_SEC ?? 3600),
    jobsDefaultCpu: src.JOBS_DEFAULT_CPU ?? '1',
    jobsDefaultMemory: src.JOBS_DEFAULT_MEMORY ?? '2g',
    jobsDefaultDisk: src.JOBS_DEFAULT_DISK ?? '20g',
    jobsDefaultMaxLogBytes: Number(
      src.JOBS_DEFAULT_MAX_LOG_BYTES ?? 10 * 1024 * 1024,
    ),
    /** Comma-separated registry hosts allowed for image pull (empty = any). */
    jobsImagePullAllowlist: (src.JOBS_IMAGE_PULL_ALLOWLIST ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    jobsMaxConcurrent: Number(src.JOBS_MAX_CONCURRENT ?? 2),
    /** Kubernetes namespace for Job objects when JOBS_RUNNER=kubernetes. */
    jobsK8sNamespace: src.JOBS_K8S_NAMESPACE ?? 'mice-jobs',
    jobsKubectlBin: src.JOBS_KUBECTL_BIN ?? 'kubectl',
    /** PLAT-SESS — desktop sessions */
    sessionsEnabled: src.SESSIONS_ENABLED !== 'false',
    sessionsDataDir: (
      src.SESSIONS_DATA_DIR ??
      `${(src.AUTH_DATA_DIR ?? './data').replace(/\/$/, '')}/sessions`
    ).replace(/\/$/, ''),
    sessionsHostDataDir: (src.SESSIONS_HOST_DATA_DIR ?? '').replace(
      /\/$/,
      '',
    ),
    sessionsProvisioner: (src.SESSIONS_PROVISIONER ?? 'docker').toLowerCase() as
      | 'docker'
      | 'libvirt'
      | 'kubevirt'
      | 'mock',
    sessionsDockerBin: src.SESSIONS_DOCKER_BIN ?? src.JOBS_DOCKER_BIN ?? 'docker',
    sessionsDockerSocket:
      src.SESSIONS_DOCKER_SOCKET ??
      src.JOBS_DOCKER_SOCKET ??
      '/var/run/docker.sock',
    sessionsDockerNetwork: src.SESSIONS_DOCKER_NETWORK ?? 'mice_mice',
    sessionsDesktopImage:
      src.SESSIONS_DESKTOP_IMAGE ??
      'lscr.io/linuxserver/rdesktop:ubuntu-xfce',
    sessionsDefaultCpu: src.SESSIONS_DEFAULT_CPU ?? '2',
    sessionsDefaultMemory: src.SESSIONS_DEFAULT_MEMORY ?? '2g',
    sessionsDefaultDisk: src.SESSIONS_DEFAULT_DISK ?? '40g',
    sessionsMaxPerUser: Number(src.SESSIONS_MAX_PER_USER ?? 2),
    sessionsMaxMounts: Number(src.SESSIONS_MAX_MOUNTS ?? 8),
    sessionsIdleTimeoutSec: Number(
      src.SESSIONS_IDLE_TIMEOUT_SECONDS ?? 4 * 60 * 60,
    ),
    sessionsMaxLifetimeSec: Number(
      src.SESSIONS_MAX_LIFETIME_SECONDS ?? 12 * 60 * 60,
    ),
    sessionsReadyTimeoutMs: Number(
      src.SESSIONS_READY_TIMEOUT_MS ?? 180_000,
    ),
    sessionsRecording: src.SESSIONS_RECORDING === 'true',
    sessionsConnectBackend: (
      src.SESSIONS_CONNECT_BACKEND ?? 'guacamole_lite'
    ).toLowerCase() as 'guacamole_lite' | 'rustguac',
    sessionsRustguacUrl: (src.SESSIONS_RUSTGUAC_URL ?? '').replace(
      /\/$/,
      '',
    ),
    sessionsRustguacApiKey: src.SESSIONS_RUSTGUAC_API_KEY ?? '',
    sessionsGuacdHost: src.SESSIONS_GUACD_HOST ?? 'guacd',
    sessionsGuacdPort: Number(src.SESSIONS_GUACD_PORT ?? 4822),
    sessionsGuacWsPath: src.SESSIONS_GUAC_WS_PATH ?? '/auth/sessions-guac',
    sessionsPublicConnectOrigin: (
      src.SESSIONS_PUBLIC_CONNECT_ORIGIN ?? ''
    ).replace(/\/$/, ''),
    /** 64 hex chars (32 bytes) for guacamole-lite AES key. */
    sessionsGuacCryptKey: sessionsGuacCryptKey(src),
    /** Phase 3: retain session audit actions at least this many days (0 = no purge). */
    sessionsAuditRetentionDays: Number(
      src.SESSIONS_AUDIT_RETENTION_DAYS ?? 365,
    ),
    /**
     * AuthZ enforcement override: 'true' | 'false' | '' (use store flag).
     * Default empty → store `enforce` (starts false until bootstrap).
     */
    authzEnforce: (src.AUTHZ_ENFORCE ?? '').toLowerCase(),
    /** Comma-separated emails or subject IDs for first instance admin. */
    authzBootstrapAdmins: src.AUTHZ_BOOTSTRAP_ADMINS ?? '',
    /**
     * When true, grant instance admin to every authenticated user.
     * Useful for local Compose / e2e; keep off in shared environments.
     */
    authzDevGrantAll: src.AUTHZ_DEV_GRANT_ALL === 'true',
    /** JSON map for IdP group / email → namespace or instance grants. */
    authzGroupBootstrap: src.AUTHZ_GROUP_BOOTSTRAP ?? '',
    /** Phase 3: require training completion before product /api. */
    authzRequireTraining: src.AUTHZ_REQUIRE_TRAINING === 'true',
    /** Public base URL clients use for oxen CLI (scheme+host+port, no path). */
    publicOxenRemote:
      src.PUBLIC_OXEN_REMOTE?.replace(/\/$/, '') ??
      `http://localhost:${src.AUTH_PORT ?? src.PORT ?? 8080}`,
    /**
     * Browser UI origin for CLI device verification links.
     * Defaults from OIDC_REDIRECT_URI origin, else localhost:5173.
     */
    publicWebOrigin: (() => {
      const explicit = src.PUBLIC_WEB_ORIGIN?.replace(/\/$/, '')
      if (explicit) return explicit
      const redirect = src.OIDC_REDIRECT_URI ?? ''
      try {
        if (redirect) return new URL(redirect).origin
      } catch {
        /* fall through */
      }
      return `http://localhost:${src.WEB_PORT ?? 5173}`
    })(),
    oidcIssuer: src.OIDC_ISSUER ?? '',
    /** Issuer URL as seen by the browser (Keycloak published hostname). */
    oidcIssuerPublic: src.OIDC_ISSUER_PUBLIC ?? src.OIDC_ISSUER ?? '',
    oidcClientId: src.OIDC_CLIENT_ID ?? '',
    oidcClientSecret: src.OIDC_CLIENT_SECRET ?? '',
    oidcRedirectUri: src.OIDC_REDIRECT_URI ?? '',
    /** Browser return URL after IdP end-session (must be allow-listed on the client). */
    oidcPostLogoutRedirectUri:
      src.OIDC_POST_LOGOUT_REDIRECT_URI ??
      src.OIDC_REDIRECT_URI?.replace(/\/auth\/callback$/, '/login') ??
      'http://localhost:5173/login',
    /** Id token claim name for IdP groups (string or string[]). */
    oidcGroupsClaim: src.OIDC_GROUPS_CLAIM ?? 'groups',
    /**
     * Directory search backend: `keycloak` | `none`.
     * Empty → keycloak when KEYCLOAK_ADMIN_URL is set, else none (store-only).
     */
    directoryProvider: (() => {
      const raw = (src.DIRECTORY_PROVIDER ?? '').toLowerCase()
      if (raw === 'keycloak' || raw === 'none') return raw
      return src.KEYCLOAK_ADMIN_URL ? 'keycloak' : 'none'
    })(),
    /** Keycloak base URL for Admin API (no /realms path), e.g. http://keycloak:8080 */
    keycloakAdminUrl: (src.KEYCLOAK_ADMIN_URL ?? '').replace(/\/$/, ''),
    keycloakRealm: src.KEYCLOAK_REALM ?? 'mice',
  }
}

export const env = loadEnv(process.env)

/** Test seam: override config values in place; returns a function restoring them. */
export function overrideEnv(patch: Partial<typeof env>): () => void {
  const previous = { ...env }
  Object.assign(env, patch)
  return () => {
    Object.assign(env, previous)
  }
}

export function oidcConfigured(): boolean {
  return Boolean(
    env.oidcIssuer &&
      env.oidcClientId &&
      env.oidcRedirectUri,
  )
}
