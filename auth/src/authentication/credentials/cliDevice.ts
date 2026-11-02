import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, gt, lt } from 'drizzle-orm'
import { currentClock, type Clock } from '../../clock.js'
import { env } from '../../env.js'
import { getDb } from '../../db/database.js'
import { deviceAuthorizations } from '../../db/schema.js'
import type { PatScope, SessionUser } from '../session/session.js'
import { CLI_ACCESS_TTL_SEC, issueCliCredential, revokeCliCredential } from './cliCredentials.js'

const DEVICE_TTL_MS = 10 * 60 * 1000
const DEFAULT_INTERVAL_SEC = 5
/** Expired records stay this long so an expired code is told apart from an unknown one. */
const PURGE_AFTER_MS = 24 * 60 * 60 * 1000
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Stored states. `expired` is derived from the clock, never stored. */
export type DeviceStatus = 'pending' | 'approved' | 'denied' | 'consumed'

export type DeviceRecord = {
  deviceCodeHash: string
  userCode: string
  status: DeviceStatus
  createdAt: string
  expiresAt: string
  scopes?: PatScope[]
  /** Present only while `approved`; removed when the CLI consumes it. */
  token?: string
  refreshToken?: string
  patId?: string
  user?: Pick<SessionUser, 'sub' | 'iss' | 'email' | 'name'>
  /** Device name/identifier from CLI (e.g., "mice-cli v1.2.3") - Ticket 25 */
  deviceName?: string
  /** Hashed IP of requesting device (SHA-256(IP + daily_salt)) - Ticket 25 */
  requestHashedIp?: string
}

/** Where device authorization records live. Every state change is one conditional, atomic write. */
export interface DeviceRepository {
  insert(record: DeviceRecord): Promise<void>
  findByHash(deviceCodeHash: string): Promise<DeviceRecord | undefined>
  /** The newest record carrying this user code, expired or not. */
  findByUserCode(userCode: string): Promise<DeviceRecord | undefined>
  /** pending and unexpired → approved. False when another request got there first. */
  approve(
    userCode: string,
    nowIso: string,
    grant: { token: string; refreshToken: string; user: NonNullable<DeviceRecord['user']> },
  ): Promise<boolean>
  /** pending and unexpired → denied. */
  deny(userCode: string, nowIso: string): Promise<boolean>
  /** approved → consumed, returning the record (with its token) exactly once. */
  consume(deviceCodeHash: string, nowIso: string): Promise<DeviceRecord | undefined>
  /** Drops records that expired before `beforeIso`. */
  purgeExpired(beforeIso: string): Promise<void>
}

type Row = typeof deviceAuthorizations.$inferSelect

function toRecord(r: Row): DeviceRecord {
  return {
    deviceCodeHash: r.deviceCodeHash,
    userCode: r.userCode,
    status: r.status as DeviceStatus,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    ...(r.scopes?.length ? { scopes: r.scopes } : {}),
    ...(r.token ? { token: r.token } : {}),
    ...(r.refreshToken ? { refreshToken: r.refreshToken } : {}),
    ...(r.patId ? { patId: r.patId } : {}),
    ...(r.userSub && r.userIss && r.userEmail && r.userName
      ? { user: { sub: r.userSub, iss: r.userIss, email: r.userEmail, name: r.userName } }
      : {}),
    ...(r.deviceName ? { deviceName: r.deviceName } : {}),
    ...(r.requestHashedIp ? { requestHashedIp: r.requestHashedIp } : {}),
  }
}

export function createPostgresDeviceRepository(): DeviceRepository {
  const pendingLive = (userCode: string, nowIso: string) =>
    and(
      eq(deviceAuthorizations.userCode, userCode),
      eq(deviceAuthorizations.status, 'pending'),
      gt(deviceAuthorizations.expiresAt, new Date(nowIso)),
    )
  return {
    async insert(r) {
      await getDb().insert(deviceAuthorizations).values({
        deviceCodeHash: r.deviceCodeHash,
        userCode: r.userCode,
        status: r.status,
        createdAt: new Date(r.createdAt),
        expiresAt: new Date(r.expiresAt),
        scopes: r.scopes ?? null,
        deviceName: r.deviceName ?? null,
        requestHashedIp: r.requestHashedIp ?? null,
      })
    },
    async findByHash(hash) {
      const [row] = await getDb().select().from(deviceAuthorizations).where(eq(deviceAuthorizations.deviceCodeHash, hash))
      return row && toRecord(row)
    },
    async findByUserCode(userCode) {
      const [row] = await getDb()
        .select()
        .from(deviceAuthorizations)
        .where(eq(deviceAuthorizations.userCode, userCode))
        .orderBy(desc(deviceAuthorizations.createdAt))
        .limit(1)
      return row && toRecord(row)
    },
    async approve(userCode, nowIso, grant) {
      const rows = await getDb()
        .update(deviceAuthorizations)
        .set({
          status: 'approved',
          token: grant.token,
          refreshToken: grant.refreshToken,
          userSub: grant.user.sub,
          userIss: grant.user.iss,
          userEmail: grant.user.email,
          userName: grant.user.name,
        })
        .where(pendingLive(userCode, nowIso))
        .returning({ hash: deviceAuthorizations.deviceCodeHash })
      return rows.length > 0
    },
    async deny(userCode, nowIso) {
      const rows = await getDb()
        .update(deviceAuthorizations)
        .set({ status: 'denied' })
        .where(pendingLive(userCode, nowIso))
        .returning({ hash: deviceAuthorizations.deviceCodeHash })
      return rows.length > 0
    },
    async consume(hash, nowIso) {
      return getDb().transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(deviceAuthorizations)
          .where(and(
            eq(deviceAuthorizations.deviceCodeHash, hash),
            eq(deviceAuthorizations.status, 'approved'),
            gt(deviceAuthorizations.expiresAt, new Date(nowIso)),
          ))
          .for('update')
        if (!row) return undefined
        await tx
          .update(deviceAuthorizations)
          .set({ status: 'consumed', token: null, refreshToken: null })
          .where(eq(deviceAuthorizations.deviceCodeHash, hash))
        return toRecord(row)
      })
    },
    async purgeExpired(beforeIso) {
      await getDb().delete(deviceAuthorizations).where(lt(deviceAuthorizations.expiresAt, new Date(beforeIso)))
    },
  }
}

/** Decides whether a poll arrives too soon for a device. Injectable so tests need no sleeps. */
export interface PollThrottle {
  /** True when this poll is too soon; otherwise records it. */
  tooSoon(deviceKey: string, nowMs: number): boolean
  forget(deviceKey: string): void
  clear(): void
}

export function createPollThrottle(minGapMs = (DEFAULT_INTERVAL_SEC - 1) * 1000): PollThrottle {
  const last = new Map<string, number>()
  return {
    tooSoon(key, now) {
      if (now - (last.get(key) ?? 0) < minGapMs) return true
      last.set(key, now)
      return false
    },
    forget: (key) => void last.delete(key),
    clear: () => last.clear(),
  }
}

export type DeviceConfig = { webOrigin: string; remote: string; authHost: string }

export type DeviceDeps = {
  repo: DeviceRepository
  clock: Clock
  config: DeviceConfig | (() => DeviceConfig)
  /** Mints the cli-login credential at approval. */
  mint: (
    user: SessionUser,
    scopes?: PatScope[],
  ) => Promise<{ token: string; refreshToken: string; expiresIn: number }>
  /** Revokes a minted credential whose approval lost a race. Does not end web sessions. */
  discard: (user: SessionUser, accessToken: string) => Promise<unknown>
  throttle?: PollThrottle
}

function hashDeviceCode(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function randomUserCode(): string {
  const bytes = randomBytes(8)
  let out = ''
  for (let i = 0; i < 8; i++) {
    out += USER_CODE_ALPHABET[bytes[i]! % USER_CODE_ALPHABET.length]
    if (i === 3) out += '-'
  }
  return out
}

function hostOf(remote: string): string {
  try {
    return new URL(remote).host
  } catch {
    return remote
  }
}

export type DeviceStartResult = {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

export type DeviceLookup = {
  userCode: string
  status: DeviceStatus
  expiresAt: string
  expired: boolean
  scopes?: PatScope[]
  /** Device name/identifier from CLI - Ticket 25 */
  deviceName?: string
  /** Hashed IP of requesting device (last 4 hex chars for display) - Ticket 25 */
  requestHashedIp?: string
}

export type ApproveResult =
  | { ok: true; userCode: string }
  | { ok: false; error: string; status?: number }

export type DenyResult =
  | { ok: true }
  | { ok: false; error: string; status?: number }

export type PollResult =
  | {
      status: 'authorization_pending'
    }
  | {
      status: 'slow_down'
      interval: number
    }
  | {
      status: 'expired_token'
    }
  | {
      status: 'access_denied'
    }
  | {
      status: 'approved'
      token: string
      refreshToken: string
      expiresIn: number
      remote: string
      authHost: string
      user: Pick<SessionUser, 'sub' | 'iss' | 'email' | 'name'>
    }
  | {
      status: 'error'
      error: string
    }

const isExpired = (rec: DeviceRecord, nowMs: number) => new Date(rec.expiresAt).getTime() <= nowMs

/** Device authorization: pending → approved → consumed, with expiry derived from the clock. */
export function createDeviceAuthorizations(deps: DeviceDeps) {
  const { repo, clock } = deps
  const throttle = deps.throttle ?? createPollThrottle()
  const config = () => (typeof deps.config === 'function' ? deps.config() : deps.config)
  const normalize = (userCode: string) => userCode.trim().toUpperCase()
  const nowIso = () => new Date(clock.now()).toISOString()

  /** Create a pending device authorization request. */
  async function start(scopes?: PatScope[], opts?: { deviceName?: string; requestHashedIp?: string }): Promise<DeviceStartResult> {
    const now = clock.now()
    await repo.purgeExpired(new Date(now - PURGE_AFTER_MS).toISOString())
    const deviceCode = randomBytes(32).toString('base64url')
    let userCode = randomUserCode()
    // Avoid colliding with an active pending user code
    for (let i = 0; i < 5; i++) {
      const existing = await repo.findByUserCode(userCode)
      if (!existing || existing.status !== 'pending' || isExpired(existing, now)) break
      userCode = randomUserCode()
    }
    await repo.insert({
      deviceCodeHash: hashDeviceCode(deviceCode),
      userCode,
      status: 'pending',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + DEVICE_TTL_MS).toISOString(),
      ...(scopes?.length ? { scopes } : {}),
      ...(opts?.deviceName ? { deviceName: opts.deviceName } : {}),
      ...(opts?.requestHashedIp ? { requestHashedIp: opts.requestHashedIp } : {}),
    })

    const verificationUri = `${config().webOrigin}/cli/device`
    return {
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri,
      verification_uri_complete: `${verificationUri}?user_code=${encodeURIComponent(userCode)}`,
      expires_in: Math.floor(DEVICE_TTL_MS / 1000),
      interval: DEFAULT_INTERVAL_SEC,
    }
  }

  async function lookup(userCode: string): Promise<DeviceLookup | null> {
    const rec = await repo.findByUserCode(normalize(userCode))
    if (!rec || isExpired(rec, clock.now())) return null
    return {
      userCode: rec.userCode,
      status: rec.status,
      expiresAt: rec.expiresAt,
      expired: false,
      ...(rec.scopes?.length ? { scopes: rec.scopes } : {}),
      ...(rec.deviceName ? { deviceName: rec.deviceName } : {}),
      ...(rec.requestHashedIp ? { requestHashedIp: rec.requestHashedIp } : {}),
    }
  }

  /** The error for a user code that cannot be acted on, or the pending record. */
  async function pendingFor(
    userCode: string,
  ): Promise<{ rec: DeviceRecord } | { error: { ok: false; error: string; status: number } }> {
    const rec = await repo.findByUserCode(userCode)
    if (!rec) return { error: { ok: false, error: 'Unknown user code', status: 404 } }
    if (isExpired(rec, clock.now())) return { error: { ok: false, error: 'Device code expired', status: 400 } }
    if (rec.status !== 'pending') {
      return { error: { ok: false, error: `Device already ${rec.status}`, status: 400 } }
    }
    return { rec }
  }

  /** Session user approves a pending device and mints a short-lived CLI credential. */
  async function approve(userCode: string, user: SessionUser): Promise<ApproveResult> {
    const code = normalize(userCode)
    const found = await pendingFor(code)
    if ('error' in found) return found.error
    const { rec } = found
    const minted = await deps.mint(user, rec.scopes)
    const won = await repo.approve(code, nowIso(), {
      token: minted.token,
      refreshToken: minted.refreshToken,
      user: { sub: user.sub, iss: user.iss, email: user.email, name: user.name },
    })
    if (!won) {
      await deps.discard(user, minted.token)
      return { ok: false, error: 'Device already approved or denied', status: 400 }
    }
    return { ok: true, userCode: rec.userCode }
  }

  async function deny(userCode: string): Promise<DenyResult> {
    const code = normalize(userCode)
    const found = await pendingFor(code)
    if ('error' in found) return found.error
    if (!(await repo.deny(code, nowIso()))) return { ok: false, error: 'Device already approved or denied', status: 400 }
    return { ok: true }
  }

  /** CLI polls with device_code until approved/denied/expired. */
  async function poll(deviceCode: string): Promise<PollResult> {
    const hash = hashDeviceCode(deviceCode.trim())
    const now = clock.now()
    const rec = await repo.findByHash(hash)
    if (!rec) return { status: 'error', error: 'unknown_device_code' }
    if (isExpired(rec, now)) return { status: 'expired_token' }

    if (throttle.tooSoon(hash, now)) return { status: 'slow_down', interval: DEFAULT_INTERVAL_SEC }

    if (rec.status === 'pending') return { status: 'authorization_pending' }
    if (rec.status === 'denied') return { status: 'access_denied' }
    if (rec.status === 'consumed') return { status: 'error', error: 'already_consumed' }
    if (rec.status === 'approved') {
      const taken = await repo.consume(hash, nowIso())
      if (!taken) return { status: 'error', error: 'already_consumed' }
      if (!taken.token || !taken.refreshToken || !taken.user) return { status: 'error', error: 'invalid_state' }
      throttle.forget(hash)
      const { remote, authHost } = config()
      return {
        status: 'approved',
        token: taken.token,
        refreshToken: taken.refreshToken,
        expiresIn: CLI_ACCESS_TTL_SEC,
        remote,
        authHost,
        user: taken.user,
      }
    }
    return { status: 'error', error: 'invalid_state' }
  }

  return { start, lookup, approve, deny, poll, clearThrottle: () => throttle.clear() }
}

const defaultThrottle = createPollThrottle()

const defaults = createDeviceAuthorizations({
  repo: createPostgresDeviceRepository(),
  clock: currentClock,
  config: () => ({
    webOrigin: env.publicWebOrigin,
    remote: env.publicOxenRemote,
    authHost: hostOf(env.publicOxenRemote),
  }),
  async mint(user, scopes) {
    const issued = await issueCliCredential(user, scopes)
    return { token: issued.accessToken, refreshToken: issued.refreshToken, expiresIn: issued.expiresIn }
  },
  discard: (_user, accessToken) => revokeCliCredential(accessToken),
  throttle: defaultThrottle,
})

export const startDeviceAuth = defaults.start
export const lookupDeviceByUserCode = defaults.lookup
export const approveDevice = defaults.approve
export const denyDevice = defaults.deny
export const pollDevice = defaults.poll

/** Test helper: clear the default instance's poll throttle. */
export function clearPollThrottle(): void {
  defaultThrottle.clear()
}
