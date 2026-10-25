import { sql } from 'drizzle-orm'
import type { PatScope } from '../session.js'
import type { JobRun } from '../jobsTypes.js'
import type { LineageOp } from '../lineage.js'
import type { DesktopSession } from '../sessionsTypes.js'
import type { MetaRecord } from '../metaTypes.js'
import type { MetaRevision } from '../metaStore.js'
import type { NotificationUser } from '../notificationsStore.js'
import type { NotificationPreferences } from '../notificationsTypes.js'
import {
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

/** Singleton row holding instance-wide switches. */
export const instanceSettings = pgTable(
  'instance_settings',
  {
    id: smallint('id').primaryKey().default(1),
    enforce: boolean('enforce').notNull().default(false),
  },
  (t) => [check('instance_settings_singleton', sql`${t.id} = 1`)],
)

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

/** Cut-offs per principal: `notBefore` ends Sessions and PATs, `sessionsNotBefore` Sessions only (epoch s). */
export const sessionRevocations = pgTable('session_revocations', {
  principalKey: text('principal_key').primaryKey(),
  notBefore: integer('not_before'),
  sessionsNotBefore: integer('sessions_not_before'),
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
    userSub: text('user_sub'),
    userIss: text('user_iss'),
    userEmail: text('user_email'),
    userName: text('user_name'),
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
