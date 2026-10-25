import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { currentClock, type Clock } from './clock.js'
import { env } from './env.js'
import { createDocumentStore } from './stores.js'
import type { PatScope, SessionUser } from './session.js'
import { createPat } from './tokens.js'

const DEVICE_TTL_MS = 10 * 60 * 1000
const DEFAULT_INTERVAL_SEC = 5
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
  patId?: string
  user?: Pick<SessionUser, 'sub' | 'iss' | 'email' | 'name'>
}

/** Where device authorization records live. */
export interface DeviceRepository {
  read(): DeviceRecord[]
  write(records: DeviceRecord[]): void
}

export function createMemoryDeviceRepository(): DeviceRepository {
  let records: DeviceRecord[] = []
  return {
    read: () => structuredClone(records),
    write: (next) => void (records = structuredClone(next)),
  }
}

type StoreFile = { version: 1; devices: DeviceRecord[] }

export function createFileDeviceRepository(path: () => string): DeviceRepository {
  const doc = createDocumentStore<StoreFile>({ path, initial: () => ({ version: 1, devices: [] }), onCorrupt: 'initial' })
  return {
    read() {
      const parsed = doc.read()
      return parsed && parsed.version === 1 && Array.isArray(parsed.devices) ? parsed.devices : []
    },
    write: (devices) => doc.write({ version: 1, devices } satisfies StoreFile),
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
  mint: (user: SessionUser, scopes?: PatScope[]) => { token: string; patId: string }
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
      patId: string
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
  const live = () => {
    const now = clock.now()
    return repo.read().filter((d) => !isExpired(d, now))
  }
  const findByUserCode = (devices: DeviceRecord[], userCode: string) => {
    const normalized = userCode.trim().toUpperCase()
    return devices.find((d) => d.userCode === normalized)
  }

  /** Create a pending device authorization request. */
  function start(scopes?: PatScope[]): DeviceStartResult {
    const devices = live()
    const deviceCode = randomBytes(32).toString('base64url')
    let userCode = randomUserCode()
    // Avoid colliding active user codes
    for (let i = 0; i < 5; i++) {
      if (!devices.some((d) => d.userCode === userCode && d.status === 'pending')) break
      userCode = randomUserCode()
    }
    const now = clock.now()
    devices.push({
      deviceCodeHash: hashDeviceCode(deviceCode),
      userCode,
      status: 'pending',
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + DEVICE_TTL_MS).toISOString(),
      ...(scopes?.length ? { scopes } : {}),
    })
    repo.write(devices)

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

  function lookup(userCode: string): DeviceLookup | null {
    const rec = findByUserCode(live(), userCode)
    if (!rec) return null
    return {
      userCode: rec.userCode,
      status: rec.status,
      expiresAt: rec.expiresAt,
      expired: false,
      ...(rec.scopes?.length ? { scopes: rec.scopes } : {}),
    }
  }

  /** Records past expiry are dropped on read, so a stale code reads as unknown or expired. */
  function pendingFor(
    devices: DeviceRecord[],
    userCode: string,
  ): { rec: DeviceRecord } | { error: { ok: false; error: string; status: number } } {
    const rec = findByUserCode(devices, userCode)
    if (!rec) {
      const stale = findByUserCode(repo.read(), userCode)
      return stale
        ? { error: { ok: false, error: 'Device code expired', status: 400 } }
        : { error: { ok: false, error: 'Unknown user code', status: 404 } }
    }
    if (rec.status !== 'pending') {
      return { error: { ok: false, error: `Device already ${rec.status}`, status: 400 } }
    }
    return { rec }
  }

  /** Session user approves a pending device; mints a cli-login PAT. */
  function approve(userCode: string, user: SessionUser): ApproveResult {
    const devices = live()
    const found = pendingFor(devices, userCode)
    if ('error' in found) return found.error
    const { rec } = found
    const { token, patId } = deps.mint(user, rec.scopes)
    rec.status = 'approved'
    rec.token = token
    rec.patId = patId
    rec.user = { sub: user.sub, iss: user.iss, email: user.email, name: user.name }
    repo.write(devices)
    return { ok: true, userCode: rec.userCode }
  }

  function deny(userCode: string): DenyResult {
    const devices = live()
    const found = pendingFor(devices, userCode)
    if ('error' in found) return found.error
    found.rec.status = 'denied'
    repo.write(devices)
    return { ok: true }
  }

  /** CLI polls with device_code until approved/denied/expired. */
  function poll(deviceCode: string): PollResult {
    const hash = hashDeviceCode(deviceCode.trim())
    const now = clock.now()
    const all = repo.read()
    const stored = all.find((d) => d.deviceCodeHash === hash)
    const devices = all.filter((d) => !isExpired(d, now))
    const rec = devices.find((d) => d.deviceCodeHash === hash)
    if (!rec) return stored ? { status: 'expired_token' } : { status: 'error', error: 'unknown_device_code' }

    if (throttle.tooSoon(hash, now)) return { status: 'slow_down', interval: DEFAULT_INTERVAL_SEC }

    if (rec.status === 'pending') return { status: 'authorization_pending' }
    if (rec.status === 'denied') return { status: 'access_denied' }
    if (rec.status === 'consumed') return { status: 'error', error: 'already_consumed' }
    if (rec.status === 'approved' && rec.token && rec.patId && rec.user) {
      const { token, patId, user } = rec
      rec.status = 'consumed'
      delete rec.token
      repo.write(devices)
      throttle.forget(hash)
      const { remote, authHost } = config()
      return { status: 'approved', token, patId, remote, authHost, user }
    }
    return { status: 'error', error: 'invalid_state' }
  }

  return { start, lookup, approve, deny, poll, clearThrottle: () => throttle.clear() }
}

const defaultThrottle = createPollThrottle()

const defaults = createDeviceAuthorizations({
  repo: createFileDeviceRepository(() => join(env.dataDir, 'cli-devices.json')),
  clock: currentClock,
  config: () => ({
    webOrigin: env.publicWebOrigin,
    remote: env.publicOxenRemote,
    authHost: hostOf(env.publicOxenRemote),
  }),
  mint(user, scopes) {
    const { token, pat } = createPat(user, 'cli-login', { source: 'cli-login', scopes })
    return { token, patId: pat.id }
  },
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
