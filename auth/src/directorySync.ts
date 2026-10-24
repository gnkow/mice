import { join } from 'node:path'
import type { Context } from 'hono'
import { actorFromUser, appendAudit, type AuditActor } from './audit.js'
import { revokeSessionsFor } from './credentialRevocation.js'
import {
  collectStorePrincipals,
  directoryIssuer,
  keycloakDirectoryConfigured,
  lookupKeycloakUserStatus,
  type DirectoryUserStatus,
} from './directory.js'
import { env } from './env.js'
import { readJsonFile, writeJsonFile } from './jsonStore.js'
import { principalKey } from './principal.js'
import { getSession } from './session.js'
import { isInstanceAdmin } from './authzStore.js'

type SyncState = {
  version: 1
  lastAttemptAt?: string
  lastSuccessAt?: string
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

const statePath = () => join(env.dataDir, 'directory-sync.json')

function readState(): SyncState {
  const s = readJsonFile<SyncState>(statePath(), { version: 1, revoked: {} })
  return s?.version === 1 && s.revoked ? s : { version: 1, revoked: {} }
}

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
      writeJsonFile(statePath(), state)
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
    revokeSessionsFor(p)
    state.revoked[key] = now
    revoked.push({ sub: p.sub, iss: p.iss })
    appendAudit({
      actor: actorFromUser({ ...p, email: p.email, name: p.name }),
      via: 'session',
      method: 'SYNC',
      path: 'directory-sync',
      status: 200,
      action: 'session.revoke',
      message: `Directory sync revoked ${p.sub}: disabled or removed in the IdP`,
      detail: { source: 'directory-sync' },
    })
  }
  for (const key of stillEnabled) delete state.revoked[key]
  state.lastSuccessAt = now
  writeJsonFile(statePath(), state)
  return { ok: true, checked: principals.length, revoked }
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
    () => void runDirectorySync().catch((e) => console.error('[mice-auth] directory sync error', e)),
    env.directorySyncIntervalSec * 1000,
  )
  timer.unref()
}
