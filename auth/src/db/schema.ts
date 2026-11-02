import { sql } from 'drizzle-orm'
import { type PatScope } from '../authentication/index.js'
import type { AccessReviewReport } from '../authentication/compliance/accessReview.js'
import type { JobRun } from '../jobsTypes.js'
import type { LineageOp } from '../lineage.js'
import type { DesktopSession } from '../sessionsTypes.js'
import type { MetaRecord } from '../metaTypes.js'
import type { MetaRevision } from '../metaStore.js'
import type { NotificationUser } from '../notificationsStore.js'
import type { NotificationPreferences } from '../notificationsTypes.js'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'


const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const instanceAdmins = pgTable('instance_admins', {
  userKey: text('user_key').primaryKey(),
})

export const instancePermissions = pgTable(
  'instance_permissions',
  {
    userKey: text('user_key').notNull(),
    permission: text('permission').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userKey, t.permission] })],
)

export const instanceTraining = pgTable('instance_training', {
  userKey: text('user_key').primaryKey(),
})

export const namespaces = pgTable('namespaces', {
  name: text('name').primaryKey(),
  basePermission: text('base_permission').notNull(),
  membersCanCreateRepos: boolean('members_can_create_repos').notNull(),
  createdAt: ts('created_at').notNull(),
  createdBy: text('created_by').notNull(),
})

export const namespaceMembers = pgTable(
  'namespace_members',
  {
    namespace: text('namespace').notNull().references(() => namespaces.name, { onDelete: 'cascade' }),
    userKey: text('user_key').notNull(),
    role: text('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.namespace, t.userKey] }), index('namespace_members_user').on(t.userKey)],
)

export const namespaceGroupMembers = pgTable(
  'namespace_group_members',
  {
    namespace: text('namespace').notNull().references(() => namespaces.name, { onDelete: 'cascade' }),
    groupKey: text('group_key').notNull(),
    role: text('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.namespace, t.groupKey] }), index('namespace_group_members_group').on(t.groupKey)],
)

export const repoCollaborators = pgTable(
  'repo_collaborators',
  {
    namespace: text('namespace').notNull().references(() => namespaces.name, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    userKey: text('user_key').notNull(),
    role: text('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.namespace, t.repo, t.userKey] }), index('repo_collaborators_user').on(t.userKey)],
)

export const repoGroupCollaborators = pgTable(
  'repo_group_collaborators',
  {
    namespace: text('namespace').notNull().references(() => namespaces.name, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    groupKey: text('group_key').notNull(),
    role: text('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.namespace, t.repo, t.groupKey] }), index('repo_group_collaborators_group').on(t.groupKey)],
)

export const customNamespaceRoles = pgTable(
  'custom_namespace_roles',
  {
    id: text('id').primaryKey(),
    namespace: text('namespace').notNull().references(() => namespaces.name, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    permissions: jsonb('permissions').$type<string[]>().notNull(),
    baseRepositoryRole: text('base_repository_role'),
  },
  (t) => [uniqueIndex('custom_namespace_roles_name').on(t.namespace, sql`lower(${t.name})`)],
)

export const customRepoRoles = pgTable(
  'custom_repo_roles',
  {
    id: text('id').primaryKey(),
    namespace: text('namespace').notNull().references(() => namespaces.name, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    base: text('base').notNull(),
    permissions: jsonb('permissions').$type<string[]>().notNull(),
  },
  (t) => [uniqueIndex('custom_repo_roles_name').on(t.namespace, sql`lower(${t.name})`)],
)

export const accessRequests = pgTable(
  'access_requests',
  {
    id: text('id').primaryKey(),
    sub: text('sub').notNull(),
    iss: text('iss').notNull(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    message: text('message').notNull(),
    createdAt: ts('created_at').notNull(),
    status: text('status').notNull(),
    resolvedAt: ts('resolved_at'),
    resolvedBy: text('resolved_by'),
  },
  (t) => [
    uniqueIndex('access_requests_one_pending')
      .on(t.sub, t.iss)
      .where(sql`${t.status} = 'pending'`),
  ],
)

/** A CLI login family: rotating refresh tokens share one 30-day expiry and one revocation. */
export const cliCredentialFamilies = pgTable('cli_credential_families', {
  id: text('id').primaryKey(),
  iss: text('iss').notNull(),
  sub: text('sub').notNull(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  scopes: jsonb('scopes').$type<PatScope[]>(),
  createdAt: ts('created_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
})

/** Hashed CLI access or refresh token. The raw value is returned once and never stored. */
export const cliCredentialTokens = pgTable('cli_credential_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  familyId: text('family_id')
    .notNull()
    .references(() => cliCredentialFamilies.id),
  kind: text('kind').notNull(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
})

/** One row per PAT, keyed by the SHA-256 of the token so a raw token is never stored. */
export const pats = pgTable(
  'pats',
  {
    tokenHash: text('token_hash').primaryKey(),
    id: text('id').notNull().unique(),
    label: text('label').notNull(),
    prefix: text('prefix').notNull(),
    sub: text('sub').notNull(),
    iss: text('iss').notNull(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    createdAt: ts('created_at').notNull(),
    lastUsedAt: ts('last_used_at'),
    expiresAt: ts('expires_at'),
    scopes: jsonb('scopes').$type<PatScope[]>(),
    source: text('source'),
    groups: jsonb('groups').$type<string[]>(),
  },
  (t) => [index('pats_owner').on(t.iss, t.sub)],
)

export const servicePrincipals = pgTable(
  'service_principals',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    ownerIss: text('owner_iss').notNull(),
    ownerSub: text('owner_sub').notNull(),
    ownerEmail: text('owner_email').notNull(),
    ownerName: text('owner_name').notNull(),
    reason: text('reason'),
    createdAt: ts('created_at').notNull(),
    status: text('status').notNull(),
    suspendedAt: ts('suspended_at'),
    suspendedCause: text('suspended_cause'),
  },
  (t) => [index('service_principals_owner').on(t.ownerIss, t.ownerSub)],
)

/**
 * Cut-offs per principal: `notBefore` ends Sessions and PATs, `sessionsNotBefore` Sessions only
 * (epoch s). `revokedAt` marks a permanent revocation that also blocks a fresh login.
 */
export const sessionRevocations = pgTable('session_revocations', {
  principalKey: text('principal_key').primaryKey(),
  notBefore: integer('not_before'),
  sessionsNotBefore: integer('sessions_not_before'),
  revokedAt: ts('revoked_at'),
})

/** A security suspension awaiting a second instance admin (24h window). */
export const suspensionRequests = pgTable(
  'suspension_requests',
  {
    id: text('id').primaryKey(),
    principalKey: text('principal_key').notNull(),
    suspendedBy: text('suspended_by').notNull(),
    reason: text('reason').notNull(),
    createdAt: ts('created_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
    confirmedBy: text('confirmed_by'),
    confirmedAt: ts('confirmed_at'),
  },
  (t) => [index('suspension_requests_principal_idx').on(t.principalKey)],
)

/** Consumed back-channel logout `jti` values; replays are rejected until the token expiry. */
export const backChannelLogoutJtis = pgTable(
  'backchannel_logout_jtis',
  {
    jti: text('jti').primaryKey(),
    consumedAt: ts('consumed_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('backchannel_logout_jtis_expiry_idx').on(t.expiresAt)],
)

/** Suspension flag written by a confirmed security suspend. Mice suspension uses `principals.flags`. */
export const principalAccessFlags = pgTable(
  'principal_access_flags',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    principalKey: text('principal_key').notNull(),
    flag: text('flag').notNull(),
    reason: text('reason').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: ts('created_at').notNull(),
    liftedBy: text('lifted_by'),
    liftedAt: ts('lifted_at'),
    liftReason: text('lift_reason'),
  },
  (t) => [index('principal_access_flags_principal_idx').on(t.principalKey)],
)

/** Identity of record: canonical issuer + IdP `sub`, with a stable internal id other tables can reference. */
export const principals = pgTable(
  'principals',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    iss: text('iss').notNull(),
    sub: text('sub').notNull(),
    createdAt: ts('created_at').notNull(),
    /** Current name from IdP (updated on each login) - Ticket 22 */
    name: text('name'),
    /** Current email from IdP (updated on each login). */
    email: text('email'),
    /** Latest web Session start. */
    lastLoginAt: ts('last_login_at'),
    /** Mice flags such as `suspended`. Independent of IdP status. */
    flags: text('flags').array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [uniqueIndex('principals_iss_sub_key').on(t.iss, t.sub)],
)

/** Set and lift of a Mice flag, with the reason, the actor, and the time. */
export const principalFlagHistory = pgTable('principal_flag_history', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  principalId: bigint('principal_id', { mode: 'number' })
    .notNull()
    .references(() => principals.id, { onDelete: 'cascade' }),
  flag: text('flag').notNull(),
  action: text('action').notNull(),
  reason: text('reason').notNull(),
  actorIss: text('actor_iss').notNull(),
  actorSub: text('actor_sub').notNull(),
  at: ts('at').notNull(),
})

/** One stored quarterly access review. A later generate for the same quarter returns this row. */
export const accessReviewReports = pgTable('access_review_reports', {
  quarter: text('quarter').primaryKey(),
  report: jsonb('report').$type<AccessReviewReport>().notNull(),
  createdAt: ts('created_at').notNull(),
})

/** Name change history for Principals (Ticket 22, U11). Tracks name over time for audit trail. */
export const principalNameHistory = pgTable(
  'principal_name_history',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    principalId: bigint('principal_id', { mode: 'number' })
      .notNull()
      .references(() => principals.id, { onDelete: 'cascade' }),
    /** Name value during this period */
    name: text('name').notNull(),
    /** When this name became valid (inclusive) */
    validFrom: ts('valid_from').notNull(),
    /** When this name stopped being valid (exclusive), NULL = current */
    validTo: ts('valid_to'),
    /** When this history record was created */
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('principal_name_history_principal_idx').on(t.principalId, t.validFrom),
  ],
)

/**
 * Ticket 05: Principal disabled periods tracking
 * 
 * Tracks when principals are disabled in the IdP and when they're re-enabled.
 * Used to determine automatic vs manual restoration of access.
 */
export const principalDisabledPeriods = pgTable(
  'principal_disabled_periods',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    principalId: bigint('principal_id', { mode: 'number' })
      .notNull()
      .references(() => principals.id, { onDelete: 'cascade' }),
    /** When the principal was first detected as disabled in IdP */
    disabledAt: ts('disabled_at').notNull(),
    /** When the principal was detected as re-enabled in IdP (null = still disabled) */
    reEnabledAt: ts('re_enabled_at'),
    /** Type of restoration: 'automatic' | 'admin-confirmed' | 'denied' | 'pending' */
    restorationType: text('restoration_type'),
    /** Principal key of admin who confirmed restoration (for admin-confirmed type) */
    confirmedBy: text('confirmed_by'),
    /** Reference to audit event for this restoration */
    auditEventId: text('audit_event_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('principal_disabled_periods_principal_idx').on(t.principalId),
    index('principal_disabled_periods_pending_idx').on(t.restorationType).where(sql`${t.restorationType} = 'pending'`),
  ],
)

/** Server-side web Session, keyed by the SHA-256 of the opaque id held in the `__Host-` cookie. */
export const webSessions = pgTable(
  'web_sessions',
  {
    idHash: text('id_hash').primaryKey(),
    principalId: bigint('principal_id', { mode: 'number' })
      .notNull()
      .references(() => principals.id),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull(),
    name: text('name').notNull(),
    idToken: text('id_token'),
    groups: jsonb('groups').$type<string[]>().notNull(),
    authTime: integer('auth_time'),
    sessionStart: integer('session_start').notNull(),
    lastActive: integer('last_active').notNull(),
  },
  (t) => [index('web_sessions_principal_idx').on(t.principalId)],
)

/** Single-use OIDC login state (10 min TTL), keyed by the SHA-256 of the opaque login cookie. */
export const loginStates = pgTable('login_states', {
  idHash: text('id_hash').primaryKey(),
  state: text('state').notNull(),
  nonce: text('nonce').notNull(),
  codeVerifier: text('code_verifier').notNull(),
  returnPath: text('return_path'),
  reauth: jsonb('reauth').$type<{ maxAge: number; sub: string; iss: string }>(),
  expiresAt: ts('expires_at').notNull(),
})

export const deviceAuthorizations = pgTable(
  'device_authorizations',
  {
    deviceCodeHash: text('device_code_hash').primaryKey(),
    userCode: text('user_code').notNull(),
    status: text('status').notNull(),
    createdAt: ts('created_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
    scopes: jsonb('scopes').$type<PatScope[]>(),
    token: text('token'),
    patId: text('pat_id'),
    /** Raw refresh token, present only while the device approval is unconsumed. */
    refreshToken: text('refresh_token'),
    userSub: text('user_sub'),
    userIss: text('user_iss'),
    userEmail: text('user_email'),
    userName: text('user_name'),
    /** Device name/identifier from CLI (e.g., "mice-cli v1.2.3") - Ticket 25 */
    deviceName: text('device_name'),
    /** Hashed IP of requesting device (SHA-256(IP + daily_salt)) - Ticket 25 */
    requestHashedIp: text('request_hashed_ip'),
  },
  (t) => [index('device_authorizations_user_code').on(t.userCode)],
)

export const servicePatExpiryNotices = pgTable('service_pat_expiry_notices', {
  patId: text('pat_id').primaryKey(),
  notifiedAt: ts('notified_at').notNull(),
})

/** Job runs: key and filter fields are columns; the rest of the run is the `body` document. */
export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    namespace: text('namespace').notNull(),
    repo: text('repo').notNull(),
    status: text('status').notNull(),
    pinCommit: text('pin_commit').notNull(),
    createdAt: ts('created_at').notNull(),
    body: jsonb('body').$type<JobRun>().notNull(),
  },
  (t) => [
    index('jobs_repo_created').on(t.namespace, t.repo, t.createdAt),
    index('jobs_status_created').on(t.status, t.createdAt),
    index('jobs_pin_commit').on(t.pinCommit),
  ],
)

/** Provisional job id → result commit id, so an old id stays resolvable after a rekey. */
export const jobAliases = pgTable('job_aliases', {
  alias: text('alias').primaryKey(),
  target: text('target').notNull(),
})

export const lineageOps = pgTable(
  'lineage_ops',
  {
    id: text('id').primaryKey(),
    namespace: text('namespace').notNull(),
    repo: text('repo').notNull(),
    ts: ts('ts').notNull(),
    body: jsonb('body').$type<LineageOp>().notNull(),
  },
  (t) => [index('lineage_ops_repo_ts').on(t.namespace, t.repo, t.ts)],
)

export const desktopSessions = pgTable(
  'desktop_sessions',
  {
    id: text('id').primaryKey(),
    status: text('status').notNull(),
    ownerSub: text('owner_sub').notNull(),
    ownerIss: text('owner_iss').notNull(),
    createdAt: ts('created_at').notNull(),
    body: jsonb('body').$type<DesktopSession>().notNull(),
  },
  (t) => [index('desktop_sessions_status').on(t.status), index('desktop_sessions_owner').on(t.ownerIss, t.ownerSub)],
)

export const favorites = pgTable(
  'favorites',
  {
    userKey: text('user_key').notNull(),
    type: text('type').notNull(),
    id: text('id').notNull(),
    at: ts('at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userKey, t.type, t.id] }), index('favorites_target').on(t.type, t.id)],
)

export const announcements = pgTable(
  'announcements',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    severity: text('severity').notNull(),
    active: boolean('active').notNull(),
    expiresAt: ts('expires_at'),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
    createdBy: text('created_by').notNull(),
  },
  (t) => [index('announcements_created').on(t.createdAt)],
)

/** Singleton row: when the directory sync last ran and whether a stale alert is outstanding. */
export const directorySyncState = pgTable(
  'directory_sync_state',
  {
    id: smallint('id').primaryKey().default(1),
    lastAttemptAt: ts('last_attempt_at'),
    lastSuccessAt: ts('last_success_at'),
    staleAlertedAt: ts('stale_alerted_at'),
    watchingSince: ts('watching_since'),
  },
  (t) => [check('directory_sync_state_singleton', sql`${t.id} = 1`)],
)

/** Principals already cut off by a sync, until the IdP shows them enabled again. */
export const directorySyncRevoked = pgTable('directory_sync_revoked', {
  principalKey: text('principal_key').primaryKey(),
  revokedAt: ts('revoked_at').notNull(),
})

/** Own metadata of one entity; the key is the entity reference key. */
export const metaRecords = pgTable('meta_records', {
  key: text('key').primaryKey(),
  body: jsonb('body').$type<MetaRecord>().notNull(),
})

/** Latest revision per entity; survives the record being deleted so revisions never repeat. */
export const metaRevisions = pgTable('meta_revisions', {
  key: text('key').primaryKey(),
  value: integer('value').notNull(),
})

/** Append-only: a revision of an entity exists once and is never updated. */
export const metaHistory = pgTable(
  'meta_history',
  {
    key: text('key').notNull(),
    revision: integer('revision').notNull(),
    body: jsonb('body').$type<MetaRevision>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.revision] })],
)

/** Last-authentication snapshot of every person the notification fan-out may address, plus their preferences. */
export const notificationUsers = pgTable('notification_users', {
  userKey: text('user_key').primaryKey(),
  identity: jsonb('identity').$type<NotificationUser['identity']>().notNull(),
  rememberedAt: ts('remembered_at').notNull(),
  claimsAt: ts('claims_at').notNull(),
  preferences: jsonb('preferences').$type<NotificationPreferences>(),
})

/** Deleted namespaces and repositories; earlier notifications about them stop being shown. */
export const notificationTombstones = pgTable('notification_tombstones', {
  resource: text('resource').primaryKey(),
  deletedAt: ts('deleted_at').notNull(),
})

/** Position in the audit ledger the notification worker has projected up to. */
export const notificationCursor = pgTable(
  'notification_cursor',
  {
    id: smallint('id').primaryKey().default(1),
    auditSeq: integer('audit_seq').notNull().default(0),
  },
  (t) => [check('notification_cursor_singleton', sql`${t.id} = 1`)],
)

/** Authentication events audit log (ticket 05). */
export const authEvents = pgTable(
  'auth_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    type: text('type').notNull(),
    principalKey: text('principal_key').notNull(),
    requestId: text('request_id').notNull(),
    outcome: text('outcome').notNull(),
    reason: text('reason'),
    timestamp: ts('timestamp').notNull().defaultNow(),
  },
  (t) => [
    index('auth_events_principal_idx').on(t.principalKey, t.timestamp),
    index('auth_events_timestamp_idx').on(t.timestamp),
  ],
)

/** IdP baseline validation checks (ticket 14). Stores results of MFA capability checks. */
export const idpBaselineChecks = pgTable(
  'idp_baseline_checks',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** When the check was performed */
    checkedAt: ts('checked_at').notNull().defaultNow(),
    /** Who triggered the check (admin principal key) */
    checkedBy: text('checked_by').notNull(),
    /** Whether IdP provides MFA evidence (acr/amr claims) */
    mfaAvailable: boolean('mfa_available').notNull(),
    /** Claims found in test id_token (acr, amr values) */
    claimsFound: jsonb('claims_found').$type<{ acr?: string; amr: string[] }>(),
    /** Error message if check failed */
    error: text('error'),
  },
  (t) => [index('idp_baseline_checks_checked_at_idx').on(t.checkedAt)],
)

/** IdP baseline configuration (ticket 23, U20). Stores validated baseline for drift detection. */
export const idpBaseline = pgTable('idp_baseline', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  /** When this baseline was established */
  establishedAt: ts('established_at').notNull().defaultNow(),
  /** Admin who established the baseline */
  establishedBy: text('established_by').notNull(),
  /** MFA claims available in tokens */
  mfaClaimsAvailable: jsonb('mfa_claims_available').$type<{ acr?: string; amr: string[] }>().notNull(),
  /** Required OIDC scopes */
  requiredScopes: jsonb('required_scopes').$type<string[]>().notNull(),
  /** Token signature algorithm (e.g., RS256) */
  signatureAlgorithm: text('signature_algorithm').notNull(),
  /** Group claim format (e.g., "array", "overage") */
  groupClaimFormat: text('group_claim_format').notNull(),
  /** OIDC issuer URL */
  issuer: text('issuer').notNull(),
  /** Whether this is the current active baseline */
  isCurrent: boolean('is_current').notNull().default(true),
})

/** IdP drift reports (ticket 23, U20). Daily checks comparing current IdP vs baseline. */
export const idpDriftReports = pgTable(
  'idp_drift_reports',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** When the drift check was performed */
    checkedAt: ts('checked_at').notNull().defaultNow(),
    /** Baseline ID that was compared against */
    baselineId: bigint('baseline_id', { mode: 'number' })
      .notNull()
      .references(() => idpBaseline.id),
    /** Whether critical drift was detected */
    hasCriticalDrift: boolean('has_critical_drift').notNull(),
    /** Whether non-critical drift was detected */
    hasNonCriticalDrift: boolean('has_non_critical_drift').notNull(),
    /** Critical drifts detected (MFA missing, algorithm changed, issuer changed) */
    criticalDrifts: jsonb('critical_drifts').$type<string[]>(),
    /** Non-critical drifts detected (group format changed, scopes expanded) */
    nonCriticalDrifts: jsonb('non_critical_drifts').$type<string[]>(),
    /** Current IdP configuration at time of check */
    currentConfig: jsonb('current_config').$type<{
      mfaClaimsAvailable?: { acr?: string; amr: string[] }
      requiredScopes: string[]
      signatureAlgorithm: string
      groupClaimFormat: string
      issuer: string
    }>().notNull(),
    /** Error message if check failed */
    error: text('error'),
  },
  (t) => [
    index('idp_drift_reports_checked_at_idx').on(t.checkedAt),
    index('idp_drift_reports_critical_idx').on(t.hasCriticalDrift),
  ],
)

/** Daily salt for hashed IP logging (ticket 16, U8). Rotates at midnight UTC for privacy. */
export const ipHashSalt = pgTable(
  'ip_hash_salt',
  {
    /** Date in YYYY-MM-DD format (UTC) */
    date: text('date').primaryKey(),
    /** Random 64-character hex salt for this date */
    salt: text('salt').notNull(),
    /** When this salt was first generated */
    createdAt: ts('created_at').notNull().defaultNow(),
  },
)

/** Device approval tracking for rate limiting (ticket 25, U15). Tracks approvals per Principal. */
export const deviceApprovals = pgTable(
  'device_approvals',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** Principal who approved (iss|sub) */
    principalKey: text('principal_key').notNull(),
    /** When the approval occurred */
    approvedAt: ts('approved_at').notNull().defaultNow(),
    /** User code that was approved */
    userCode: text('user_code').notNull(),
    /** Hashed IP of the approver (for audit) */
    approverHashedIp: text('approver_hashed_ip'),
  },
  (t) => [
    index('device_approvals_principal_time_idx').on(t.principalKey, t.approvedAt),
  ],
)

/** General rate limit tracking (ticket 24, U22). Tracks requests per key (IP or Principal) per endpoint. */
export const rateLimits = pgTable(
  'rate_limits',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** Rate limit key: "ip:<hashed_ip>" or "principal:<iss|sub>" */
    limitKey: text('limit_key').notNull(),
    /** Endpoint being rate-limited (e.g., "login", "device_flow", "refresh", "token_mint") */
    endpoint: text('endpoint').notNull(),
    /** When this request occurred */
    requestedAt: ts('requested_at').notNull().defaultNow(),
  },
  (t) => [
    index('rate_limits_key_endpoint_time_idx').on(t.limitKey, t.endpoint, t.requestedAt),
  ],
)

/** Ticket 17: Session seal key ring for emergency rotation (U7, U16) */
export const sealKeys = pgTable(
  'seal_keys',
  {
    id: text('id').primaryKey(),
    /** Base64-encoded key material (32 bytes for AES-256-GCM) */
    keyMaterial: text('key_material').notNull(),
    /** Epoch seconds when this key becomes valid */
    validFrom: integer('valid_from').notNull(),
    /** Epoch seconds when this key expires (null = current primary key) */
    validUntil: integer('valid_until'),
    /** Epoch seconds when key was revoked (emergency rotation) */
    revokedAt: integer('revoked_at'),
    /** Type of rotation: 'normal' (30-day schedule) or 'emergency' (compromised key) */
    rotationType: text('rotation_type').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    index('seal_keys_valid_from_idx').on(t.validFrom),
    index('seal_keys_valid_until_idx').on(t.validUntil),
  ],
)
