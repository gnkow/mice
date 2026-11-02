import { notInArray } from 'drizzle-orm'
import type { Context } from 'hono'
import { appendAudit, type AuditActor } from '../../audit.js'
import {
  collectStorePrincipals,
  directoryIssuer,
  keycloakDirectoryConfigured,
  lookupKeycloakUserStatus,
  type DirectoryUserStatus,
} from './directory.js'
import { env } from '../../env.js'
import { getDb } from '../../db/database.js'
import { directorySyncRevoked, directorySyncState } from '../../db/schema.js'
import { principalKey } from '../session/principal.js'
import { authenticateUser } from '../session/requireAuth.js'
import { listInstanceAdmins } from '../../authzInstanceStore.js'
import { decideInstanceAction } from '../../authz.js'
import { denialResponse } from '../../decisionHttp.js'
import { emitNotification } from '../../notifications.js'
import { offboard, type OffboardStep } from '../credentials/offboarding.js'

type SyncState = {
  lastAttemptAt?: string
  lastSuccessAt?: string
  /** Set while a stale alert is outstanding; cleared by the next successful run. */
  staleAlertedAt?: string
  /** Baseline for staleness before the first success. */
  watchingSince?: string
  /** Principals already cut off by a sync, until the IdP shows them enabled again. */
  revoked: Record<string, string>
}

export type IncompleteOffboarding = {
  sub: string
  iss: string
  failed: Array<{ step: OffboardStep; error: string }>
}

/** `revoked` are fully offboarded; `incomplete` ones are retried by the next run. */
export type SyncResult =
  | { ok: true; checked: number; revoked: Array<{ sub: string; iss: string }>; incomplete: IncompleteOffboarding[] }
  | { ok: false; error: string }

const SYSTEM_ACTOR: AuditActor = {
  sub: 'directory-sync',
  iss: 'urn:mice:system',
  email: '',
  name: 'Directory sync',
}

const iso = (d: Date | null): string | undefined => d?.toISOString()
const date = (v: string | undefined): Date | null => (v ? new Date(v) : null)

async function readState(): Promise<SyncState> {
  const db = getDb()
  const [row] = await db.select().from(directorySyncState)
  const revoked: Record<string, string> = {}
  for (const r of await db.select().from(directorySyncRevoked)) revoked[r.principalKey] = r.revokedAt.toISOString()
  return {
    ...(row?.lastAttemptAt ? { lastAttemptAt: iso(row.lastAttemptAt) } : {}),
    ...(row?.lastSuccessAt ? { lastSuccessAt: iso(row.lastSuccessAt) } : {}),
    ...(row?.staleAlertedAt ? { staleAlertedAt: iso(row.staleAlertedAt) } : {}),
    ...(row?.watchingSince ? { watchingSince: iso(row.watchingSince) } : {}),
    revoked,
  }
}

async function writeState(state: SyncState): Promise<void> {
  const cols = {
    lastAttemptAt: date(state.lastAttemptAt),
    lastSuccessAt: date(state.lastSuccessAt),
    staleAlertedAt: date(state.staleAlertedAt),
    watchingSince: date(state.watchingSince),
  }
  await getDb().transaction(async (tx) => {
    await tx.insert(directorySyncState).values({ id: 1, ...cols }).onConflictDoUpdate({ target: directorySyncState.id, set: cols })
    const keys = Object.keys(state.revoked)
    await (keys.length
      ? tx.delete(directorySyncRevoked).where(notInArray(directorySyncRevoked.principalKey, keys))
      : tx.delete(directorySyncRevoked))
    for (const [principalKey, at] of Object.entries(state.revoked)) {
      await tx
        .insert(directorySyncRevoked)
        .values({ principalKey, revokedAt: new Date(at) })
        .onConflictDoNothing()
    }
  })
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
  const state = await readState()
  const now = new Date(Date.now()).toISOString()
  state.lastAttemptAt = now

  const idp = norm(directoryIssuer())
  const principals = [...(await collectStorePrincipals()).values()].filter(
    (p) => norm(p.iss) === idp,
  )
  const gone: typeof principals = []
  const stillEnabled = new Set<string>()
  for (const p of principals) {
    const status = await lookup(p)
    if (status === 'error') {
      await writeState(state)
      await appendAudit({
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
  const incomplete: IncompleteOffboarding[] = []
  for (const p of gone) {
    const key = principalKey(p)
    if (state.revoked[key]) continue
    const result = await offboard(p, {
      scope: 'all',
      cause: 'directory-sync',
      strictAudit: true,
      message: `Directory sync revoked ${p.sub}: disabled or removed in the IdP`,
      path: 'directory-sync',
    })
    if (result.ok) {
      state.revoked[key] = now
      revoked.push({ sub: p.sub, iss: p.iss })
      continue
    }
    const failed = 'failed' in result ? result.failed : [{ step: 'revoke-credentials' as const, error: result.error }]
    incomplete.push({ sub: p.sub, iss: p.iss, failed })
    console.error(`[mice-auth] directory sync offboarding incomplete for ${p.sub}`, failed)
    await appendAudit({
      actor: SYSTEM_ACTOR,
      via: 'session',
      method: 'SYNC',
      path: 'directory-sync',
      status: 500,
      action: 'directory.sync.failed',
      message: `Offboarding of ${p.sub} is incomplete; it will be retried`,
      detail: { source: 'directory-sync', subject: { sub: p.sub, iss: p.iss }, failed },
    })
  }
  for (const key of stillEnabled) delete state.revoked[key]
  state.lastSuccessAt = now
  delete state.staleAlertedAt
  await writeState(state)
  return { ok: true, checked: principals.length, revoked, incomplete }
}

/**
 * Raises one audit event and one admin notification when no sync has succeeded for more
 * than twice the interval. Returns true when it alerted.
 */
export async function checkDirectorySyncStale(intervalSec: number = env.directorySyncIntervalSec): Promise<boolean> {
  const state = await readState()
  const nowMs = Date.now()
  state.watchingSince ??= new Date(nowMs).toISOString()
  const baseline = Date.parse(state.lastSuccessAt ?? state.watchingSince)
  const stale = nowMs - baseline > 2 * intervalSec * 1000
  if (!stale || state.staleAlertedAt) {
    await writeState(state)
    return false
  }
  state.staleAlertedAt = new Date(nowMs).toISOString()
  await writeState(state)
  await appendAudit({
    actor: SYSTEM_ACTOR,
    via: 'session',
    method: 'SYNC',
    path: 'directory-sync',
    status: 200,
    action: 'directory.sync.stale',
    message: 'Directory sync has not succeeded for more than twice its interval',
    detail: { source: 'directory-sync', lastSuccessAt: state.lastSuccessAt ?? null },
  })
  await emitNotification({
    id: `directory-sync-stale:${state.staleAlertedAt}`,
    category: 'security',
    title: 'Directory sync is stale',
    summary: 'Offboarded users are not being revoked: the directory sync has not succeeded recently.',
    audience: 'personal',
    recipients: await listInstanceAdmins(),
    href: '/profile',
  })
  return true
}

/** Instance-admin on-demand run. */
export function makeDirectorySyncRoute(run: () => Promise<SyncResult> = runDirectorySync) {
  return async (c: Context): Promise<Response> => {
    const session = await authenticateUser(c, { credential: 'session' })
    if (!session) return c.json({ error: 'Authentication required' }, 401)
    const denied = denialResponse(c, await decideInstanceAction(session, 'directory.sync'))
    if (denied) return denied
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
