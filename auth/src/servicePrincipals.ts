import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { env } from './env.js'
import { readJsonFile, writeJsonFile } from './jsonStore.js'
import { can, principalKey, serviceIdentity } from './principal.js'
import type { SessionUser } from './session.js'


export type ServiceOwner = { iss: string; sub: string; email: string; name: string }
export type ServicePrincipal = {
  id: string
  name: string
  owner: ServiceOwner
  createdAt: string
  status: 'active' | 'suspended'
  suspendedAt?: string
  suspendedCause?: string
}

type Store = { version: 1; principals: ServicePrincipal[] }
type Result<T> = ({ ok: true } & T) | { ok: false; error: string }

const path = () => join(env.dataDir, 'service-principals.json')

function read(): Store {
  const s = readJsonFile<Store | null>(path(), null)
  return s?.version === 1 && Array.isArray(s.principals) ? s : { version: 1, principals: [] }
}

const write = (s: Store) => writeJsonFile(path(), s)

/** Owners are always human: a service principal can never own another. */
function parseOwner(o: unknown): ServiceOwner | null {
  const v = o as Partial<ServiceOwner> | undefined
  if (!v || typeof v.iss !== 'string' || typeof v.sub !== 'string' || !v.iss || !v.sub) return null
  if (!can({ iss: v.iss }, 'canOwnServicePrincipals')) return null
  return { iss: v.iss, sub: v.sub, email: v.email ?? '', name: v.name ?? '' }
}

/** The Principal a service principal authenticates as. */
export function serviceUser(p: Pick<ServicePrincipal, 'id' | 'name'>): SessionUser {
  return { ...serviceIdentity(p.id), email: '', name: p.name }
}

export function createServicePrincipal(input: {
  name: string
  owner: unknown
}): Result<{ principal: ServicePrincipal }> {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 100) return { ok: false, error: 'name required (max 100 chars)' }
  const owner = parseOwner(input.owner)
  if (!owner) return { ok: false, error: 'A human owner (iss, sub) is required' }
  const principal: ServicePrincipal = {
    id: randomUUID(),
    name,
    owner,
    createdAt: new Date(Date.now()).toISOString(),
    status: 'active',
  }
  const s = read()
  s.principals.push(principal)
  write(s)
  return { ok: true, principal }
}

export function listServicePrincipals(): ServicePrincipal[] {
  return read().principals
}

export function getServicePrincipal(id: string): (ServicePrincipal & { record: true }) | undefined {
  const p = read().principals.find((x) => x.id === id)
  return p ? { ...p, record: true } : undefined
}

/** Credentials of a service principal work only while its record exists and is active. */
export function isServiceCredentialActive(id: string): boolean {
  return read().principals.find((x) => x.id === id)?.status === 'active'
}

/**
 * Suspends (does not delete) every active service principal owned by `owner`. Returns the
 * ones suspended; principals with any other owner are untouched.
 */
export function suspendOwnedBy(
  owner: { iss: string; sub: string },
  cause: string,
): ServicePrincipal[] {
  const s = read()
  const key = principalKey(owner)
  const hit = s.principals.filter((p) => p.status === 'active' && principalKey(p.owner) === key)
  if (!hit.length) return []
  const at = new Date(Date.now()).toISOString()
  for (const p of hit) Object.assign(p, { status: 'suspended', suspendedAt: at, suspendedCause: cause })
  write(s)
  return hit
}

/** Assigns a new human owner and reactivates; existing PATs keep working. */
export function reassignServicePrincipal(id: string, newOwner: unknown): Result<{ principal: ServicePrincipal }> {
  const owner = parseOwner(newOwner)
  if (!owner) return { ok: false, error: 'A human owner (iss, sub) is required' }
  const s = read()
  const p = s.principals.find((x) => x.id === id)
  if (!p) return { ok: false, error: 'Not found' }
  p.owner = owner
  p.status = 'active'
  delete p.suspendedAt
  delete p.suspendedCause
  write(s)
  return { ok: true, principal: p }
}
