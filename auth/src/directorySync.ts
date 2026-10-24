import { join } from 'node:path'
import type { Context } from 'hono'
import { appendAudit, type AuditActor } from './audit.js'
import {
  collectStorePrincipals,
  directoryIssuer,
  keycloakDirectoryConfigured,
  lookupKeycloakUserStatus,
  type DirectoryUserStatus,
} from './directory.js'
import { env } from './env.js'
import { defineStore } from './typedStore.js'
import { principalKey } from './principal.js'
import { getSession } from './session.js'
import { isInstanceAdmin, listInstanceAdmins } from './authzStore.js'
import { emitNotification } from './notifications.js'
import { offboard } from './offboarding.js'

type SyncState = {
  version: 1
  lastAttemptAt?: string
  lastSuccessAt?: string
  /** Set while a stale alert is outstanding; cleared by the next successful run. */
  staleAlertedAt?: string
  /** Baseline for staleness before the first success. */
  watchingSince?: string
  /** Principals already cut off by a sync, until the IdP shows them enabled again. */
  revoked: Record<string, string>
}

export type SyncResult =
  | { ok: true; checked: number; revoked: Array<{ sub: string; iss: string }> }
  | { ok: false; error: string }

const SYSTEM_ACTOR: AuditActor = {
  sub: 'directory-sync',
  iss: 'urn:mice:system',
  email: '',
  name: 'Directory sync',
}

const store = defineStore<SyncState>({
  file: () => join(env.dataDir, 'directory-sync.json'),
  empty: () => ({ version: 1, revoked: {} }),
  valid: (raw) => (raw as SyncState | null)?.version === 1 && !!(raw as SyncState).revoked,
})
const readState = store.read

export function directorySyncState(): Pick<SyncState, 'lastAttemptAt' | 'lastSuccessAt'> {
  const { lastAttemptAt, lastSuccessAt } = readState()
  return { lastAttemptAt, lastSuccessAt }
}

const norm = (iss: string) => iss.replace(/\/$/, '')

/**
 * Compares the IdP directory with known Principals and sets the full cut-off for those
 * disabled or removed. Fails open: if the directory cannot answer, nobody is revoked.
 */
export async function runDirectorySync(
  opts: { lookup?: (p: { sub: string; iss: string }) => Promise<DirectoryUserStatus> } = {},
): Promise<SyncResult> {
  const lookup = opts.lookup ?? ((p) => lookupKeycloakUserStatus(p.sub))
  const state = readState()
  const now = new Date(Date.now()).toISOString()
  state.lastAttemptAt = now

  const idp = norm(directoryIssuer())
  const principals = [...collectStorePrincipals({ includePatOwners: true }).values()].filter(
    (p) => norm(p.iss) === idp,
  )
  const gone: typeof principals = []
  const stillEnabled = new Set<string>()
  for (const p of principals) {
    const status = await lookup(p)
    if (status === 'error') {
      store.write(state)
      appendAudit({
        actor: SYSTEM_ACTOR,
        via: 'session',
        method: 'SYNC',
        path: 'directory-sync',
        status: 502,
        action: 'directory.sync.failed',
        message: 'Directory unreachable; nobody was revoked',
        detail: { source: 'directory-sync' },
      })
      return { ok: false, error: 'Directory unreachable' }
    }
    if (status === 'enabled') stillEnabled.add(principalKey(p))
    else gone.push(p)
  }

  const revoked: Array<{ sub: string; iss: string }> = []
  for (const p of gone) {
    const key = principalKey(p)
    if (state.revoked[key]) continue
    offboard(p, {
      scope: 'all',
      cause: 'directory-sync',
      message: `Directory sync revoked ${p.sub}: disabled or removed in the IdP`,
      path: 'directory-sync',
    })
    state.revoked[key] = now
    revoked.push({ sub: p.sub, iss: p.iss })
  }
  for (const key of stillEnabled) delete state.revoked[key]
  state.lastSuccessAt = now
  delete state.staleAlertedAt
  store.write(state)
  return { ok: true, checked: principals.length, revoked }
}

/**
 * Raises one audit event and one admin notification when no sync has succeeded for more
 * than twice the interval. Returns true when it alerted.
 */
export function checkDirectorySyncStale(intervalSec: number = env.directorySyncIntervalSec): boolean {
  const state = readState()
  const nowMs = Date.now()
  state.watchingSince ??= new Date(nowMs).toISOString()
  const baseline = Date.parse(state.lastSuccessAt ?? state.watchingSince)
  const stale = nowMs - baseline > 2 * intervalSec * 1000
  if (!stale || state.staleAlertedAt) {
    store.write(state)
    return false
  }
  state.staleAlertedAt = new Date(nowMs).toISOString()
  store.write(state)
  appendAudit({
    actor: SYSTEM_ACTOR,
    via: 'session',
    method: 'SYNC',
    path: 'directory-sync',
    status: 200,
    action: 'directory.sync.stale',
    message: 'Directory sync has not succeeded for more than twice its interval',
    detail: { source: 'directory-sync', lastSuccessAt: state.lastSuccessAt ?? null },
  })
  emitNotification({
    id: `directory-sync-stale:${state.staleAlertedAt}`,
    category: 'security',
    title: 'Directory sync is stale',
    summary: 'Offboarded users are not being revoked: the directory sync has not succeeded recently.',
    audience: 'personal',
    recipients: listInstanceAdmins(),
    href: '/profile',
  })
  return true
}

/** Instance-admin on-demand run. */
export function makeDirectorySyncRoute(run: () => Promise<SyncResult> = runDirectorySync) {
  return async (c: Context): Promise<Response> => {
    const session = await getSession(c)
    if (!session) return c.json({ error: 'Authentication required' }, 401)
    if (!isInstanceAdmin(session)) return c.json({ error: 'Instance admin required' }, 403)
    const result = await run()
    return c.json(result, result.ok ? 200 : 502)
  }
}

let timer: ReturnType<typeof setInterval> | undefined

/** Starts the periodic sync when a directory provider and an interval are configured. */
export function startDirectorySyncSchedule(): void {
  if (timer || !keycloakDirectoryConfigured() || env.directorySyncIntervalSec <= 0) return
  timer = setInterval(
    () =>
      void runDirectorySync()
        .catch((e) => console.error('[mice-auth] directory sync error', e))
        .finally(() => checkDirectorySyncStale()),
    env.directorySyncIntervalSec * 1000,
  )
  timer.unref()
}
