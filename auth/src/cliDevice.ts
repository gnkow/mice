import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { env } from './env.js'
import { readJsonFile, writeJsonFile } from './jsonStore.js'
import type { PatScope, SessionUser } from './session.js'
import { createPat } from './tokens.js'

const DEVICE_TTL_MS = 10 * 60 * 1000
const DEFAULT_INTERVAL_SEC = 5
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export type DeviceStatus = 'pending' | 'approved' | 'denied' | 'consumed'

type DeviceRecord = {
  deviceCodeHash: string
  userCode: string
  status: DeviceStatus
  createdAt: string
  expiresAt: string
  scopes?: PatScope[]
  /** Populated after approve; cleared after successful poll consume. */
  token?: string
  patId?: string
  user?: Pick<SessionUser, 'sub' | 'iss' | 'email' | 'name'>
}

type StoreFile = { version: 1; devices: DeviceRecord[] }

function storePath(): string {
  return join(env.dataDir, 'cli-devices.json')
}

function hashDeviceCode(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function readStore(): StoreFile {
  const parsed = readJsonFile<StoreFile>(storePath(), {
    version: 1,
    devices: [],
  })
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.devices)) {
    return { version: 1, devices: [] }
  }
  return parsed
}

function writeStore(store: StoreFile): void {
  writeJsonFile(storePath(), store)
}

function purgeExpired(store: StoreFile, now = Date.now()): StoreFile {
  store.devices = store.devices.filter(
    (d) => new Date(d.expiresAt).getTime() > now,
  )
  return store
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

function publicAuthHost(): string {
  try {
    return new URL(env.publicOxenRemote).host
  } catch {
    return env.publicOxenRemote
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

/** Create a pending device authorization request. */
export function startDeviceAuth(scopes?: PatScope[]): DeviceStartResult {
  const store = purgeExpired(readStore())
  const deviceCode = randomBytes(32).toString('base64url')
  let userCode = randomUserCode()
  // Avoid colliding active user codes
  for (let i = 0; i < 5; i++) {
    const clash = store.devices.some(
      (d) =>
        d.userCode === userCode &&
        d.status === 'pending' &&
        new Date(d.expiresAt).getTime() > Date.now(),
    )
    if (!clash) break
    userCode = randomUserCode()
  }
  const now = Date.now()
  const rec: DeviceRecord = {
    deviceCodeHash: hashDeviceCode(deviceCode),
    userCode,
    status: 'pending',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DEVICE_TTL_MS).toISOString(),
    ...(scopes?.length ? { scopes } : {}),
  }
  store.devices.push(rec)
  writeStore(store)

  const verificationUri = `${env.publicWebOrigin}/cli/device`
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    verification_uri_complete: `${verificationUri}?user_code=${encodeURIComponent(userCode)}`,
    expires_in: Math.floor(DEVICE_TTL_MS / 1000),
    interval: DEFAULT_INTERVAL_SEC,
  }
}

export type DeviceLookup = {
  userCode: string
  status: DeviceStatus
  expiresAt: string
  expired: boolean
  scopes?: PatScope[]
}

export function lookupDeviceByUserCode(userCode: string): DeviceLookup | null {
  const store = purgeExpired(readStore())
  const normalized = userCode.trim().toUpperCase()
  const rec = store.devices.find((d) => d.userCode === normalized)
  if (!rec) return null
  const expired = new Date(rec.expiresAt).getTime() <= Date.now()
  return {
    userCode: rec.userCode,
    status: expired && rec.status === 'pending' ? 'pending' : rec.status,
    expiresAt: rec.expiresAt,
    expired,
    ...(rec.scopes?.length ? { scopes: rec.scopes } : {}),
  }
}

export type ApproveResult =
  | { ok: true; userCode: string }
  | { ok: false; error: string; status?: number }

/** Session user approves a pending device; mints a cli-login PAT. */
export function approveDevice(
  userCode: string,
  user: SessionUser,
): ApproveResult {
  const store = purgeExpired(readStore())
  const normalized = userCode.trim().toUpperCase()
  const rec = store.devices.find((d) => d.userCode === normalized)
  if (!rec) return { ok: false, error: 'Unknown user code', status: 404 }
  if (new Date(rec.expiresAt).getTime() <= Date.now()) {
    return { ok: false, error: 'Device code expired', status: 400 }
  }
  if (rec.status !== 'pending') {
    return { ok: false, error: `Device already ${rec.status}`, status: 400 }
  }

  const { token, pat } = createPat(user, 'cli-login', {
    source: 'cli-login',
    scopes: rec.scopes,
  })
  rec.status = 'approved'
  rec.token = token
  rec.patId = pat.id
  rec.user = {
    sub: user.sub,
    iss: user.iss,
    email: user.email,
    name: user.name,
  }
  writeStore(store)
  return { ok: true, userCode: rec.userCode }
}

export type DenyResult =
  | { ok: true }
  | { ok: false; error: string; status?: number }

export function denyDevice(userCode: string): DenyResult {
  const store = purgeExpired(readStore())
  const normalized = userCode.trim().toUpperCase()
  const rec = store.devices.find((d) => d.userCode === normalized)
  if (!rec) return { ok: false, error: 'Unknown user code', status: 404 }
  if (new Date(rec.expiresAt).getTime() <= Date.now()) {
    return { ok: false, error: 'Device code expired', status: 400 }
  }
  if (rec.status !== 'pending') {
    return { ok: false, error: `Device already ${rec.status}`, status: 400 }
  }
  rec.status = 'denied'
  writeStore(store)
  return { ok: true }
}

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

const lastPollAt = new Map<string, number>()

/** CLI polls with device_code until approved/denied/expired. */
export function pollDevice(deviceCode: string): PollResult {
  const hash = hashDeviceCode(deviceCode.trim())
  const store = purgeExpired(readStore())
  const rec = store.devices.find((d) => d.deviceCodeHash === hash)
  if (!rec) return { status: 'error', error: 'unknown_device_code' }

  const now = Date.now()
  if (new Date(rec.expiresAt).getTime() <= now && rec.status === 'pending') {
    return { status: 'expired_token' }
  }

  const prev = lastPollAt.get(hash) ?? 0
  if (now - prev < (DEFAULT_INTERVAL_SEC - 1) * 1000) {
    return { status: 'slow_down', interval: DEFAULT_INTERVAL_SEC }
  }
  lastPollAt.set(hash, now)

  if (rec.status === 'pending') return { status: 'authorization_pending' }
  if (rec.status === 'denied') return { status: 'access_denied' }
  if (rec.status === 'consumed') {
    return { status: 'error', error: 'already_consumed' }
  }
  if (rec.status === 'approved' && rec.token && rec.patId && rec.user) {
    const token = rec.token
    const patId = rec.patId
    const user = rec.user
    // One-time redeem
    rec.status = 'consumed'
    delete rec.token
    writeStore(store)
    lastPollAt.delete(hash)
    return {
      status: 'approved',
      token,
      patId,
      remote: env.publicOxenRemote,
      authHost: publicAuthHost(),
      user,
    }
  }
  return { status: 'error', error: 'invalid_state' }
}

/** Test helper: clear in-memory poll throttle. */
export function clearPollThrottle(): void {
  lastPollAt.clear()
}
