import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { env } from './env.js'
import { getDb } from './db/database.js'
import { servicePrincipals } from './db/schema.js'
import { can, serviceIdentity } from './principal.js'
import type { SessionUser } from './session.js'


export type ServiceOwner = { iss: string; sub: string; email: string; name: string }
export type ServicePrincipal = {
  id: string
  name: string
  owner: ServiceOwner
  /** Fixed reason recorded for every mutation this principal makes without an explicit one. */
  reason?: string
  createdAt: string
  status: 'active' | 'suspended'
  suspendedAt?: string
  suspendedCause?: string
}

type Result<T> = ({ ok: true } & T) | { ok: false; error: string }
type Row = typeof servicePrincipals.$inferSelect

/**
 * Last-seen service principals. The synchronous reason resolver
 * resolves a service actor's owner and registered reason from here; every read and write
 * through this module refreshes it, and a PAT is resolved (reading the row) before any audited action.
 */
const seen = new Map<string, ServicePrincipal>()

export function peekServicePrincipal(id: string): ServicePrincipal | undefined {
  return seen.get(id)
}

function toPrincipal(r: Row): ServicePrincipal {
  const p = mapRow(r)
  seen.set(p.id, p)
  return p
}

function mapRow(r: Row): ServicePrincipal {
  return {
    id: r.id,
    name: r.name,
    owner: { iss: r.ownerIss, sub: r.ownerSub, email: r.ownerEmail, name: r.ownerName },
    ...(r.reason ? { reason: r.reason } : {}),
    createdAt: r.createdAt.toISOString(),
    status: r.status as ServicePrincipal['status'],
    ...(r.suspendedAt ? { suspendedAt: r.suspendedAt.toISOString() } : {}),
    ...(r.suspendedCause ? { suspendedCause: r.suspendedCause } : {}),
  }
}

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

/** A registered reason must meet the same minimum length as any other reason. */
function parseRegisteredReason(raw: unknown): Result<{ reason: string | undefined }> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, reason: undefined }
  const reason = typeof raw === 'string' ? raw.trim() : ''
  if (reason.length < env.auditReasonMinLength || reason.length > 1000) {
    return { ok: false, error: `reason must be ${env.auditReasonMinLength}-1000 characters` }
  }
  return { ok: true, reason }
}

export async function createServicePrincipal(input: {
  name: string
  owner: unknown
  reason?: unknown
}): Promise<Result<{ principal: ServicePrincipal }>> {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 100) return { ok: false, error: 'name required (max 100 chars)' }
  const owner = parseOwner(input.owner)
  if (!owner) return { ok: false, error: 'A human owner (iss, sub) is required' }
  const registered = parseRegisteredReason(input.reason)
  if (!registered.ok) return registered
  const [row] = await getDb()
    .insert(servicePrincipals)
    .values({
      id: randomUUID(),
      name,
      ownerIss: owner.iss,
      ownerSub: owner.sub,
      ownerEmail: owner.email,
      ownerName: owner.name,
      reason: registered.reason ?? null,
      createdAt: new Date(Date.now()),
      status: 'active',
    })
    .returning()
  return { ok: true, principal: toPrincipal(row!) }
}

/** Sets (or, with an empty value, clears) the registered reason. */
export async function updateServicePrincipalReason(id: string, raw: unknown): Promise<Result<{ principal: ServicePrincipal }>> {
  const registered = parseRegisteredReason(raw)
  if (!registered.ok) return registered
  const [row] = await getDb()
    .update(servicePrincipals)
    .set({ reason: registered.reason ?? null })
    .where(eq(servicePrincipals.id, id))
    .returning()
  return row ? { ok: true, principal: toPrincipal(row) } : { ok: false, error: 'Not found' }
}

export async function listServicePrincipals(): Promise<ServicePrincipal[]> {
  return (await getDb().select().from(servicePrincipals)).map(toPrincipal)
}

export async function getServicePrincipal(id: string): Promise<(ServicePrincipal & { record: true }) | undefined> {
  const [row] = await getDb().select().from(servicePrincipals).where(eq(servicePrincipals.id, id))
  return row ? { ...toPrincipal(row), record: true } : undefined
}

/** Credentials of a service principal work only while its record exists and is active. */
export async function isServiceCredentialActive(id: string): Promise<boolean> {
  const [row] = await getDb().select().from(servicePrincipals).where(eq(servicePrincipals.id, id))
  if (!row) return false
  toPrincipal(row)
  return row.status === 'active'
}

/**
 * Suspends (does not delete) every active service principal owned by `owner`. Returns the
 * ones suspended; principals with any other owner are untouched.
 */
export async function suspendOwnedBy(
  owner: { iss: string; sub: string },
  cause: string,
): Promise<ServicePrincipal[]> {
  const rows = await getDb()
    .update(servicePrincipals)
    .set({ status: 'suspended', suspendedAt: new Date(Date.now()), suspendedCause: cause })
    .where(and(
      eq(servicePrincipals.status, 'active'),
      eq(servicePrincipals.ownerIss, owner.iss),
      eq(servicePrincipals.ownerSub, owner.sub),
    ))
    .returning()
  return rows.map(toPrincipal)
}

/** Assigns a new human owner and reactivates; existing PATs keep working. */
export async function reassignServicePrincipal(id: string, newOwner: unknown): Promise<Result<{ principal: ServicePrincipal }>> {
  const owner = parseOwner(newOwner)
  if (!owner) return { ok: false, error: 'A human owner (iss, sub) is required' }
  const [row] = await getDb()
    .update(servicePrincipals)
    .set({
      ownerIss: owner.iss,
      ownerSub: owner.sub,
      ownerEmail: owner.email,
      ownerName: owner.name,
      status: 'active',
      suspendedAt: null,
      suspendedCause: null,
    })
    .where(eq(servicePrincipals.id, id))
    .returning()
  return row ? { ok: true, principal: toPrincipal(row) } : { ok: false, error: 'Not found' }
}
