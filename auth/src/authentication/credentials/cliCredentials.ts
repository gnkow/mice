import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { currentClock, type Clock } from '../../clock.js'
import { getDb } from '../../db/database.js'
import { cliCredentialFamilies, cliCredentialTokens, principals, webSessions } from '../../db/schema.js'
import { directoryNow } from '../directory/directory.js'
import type { CliCredentialScope, SessionUser } from '../session/session.js'

/** Access tokens last 8 hours. The refresh family lasts 30 days. */
export const CLI_ACCESS_TTL_SEC = 8 * 60 * 60
const FAMILY_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type IdpAccess = 'enabled' | 'disabled' | 'unreachable'

export type IssuedCliCredential = {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export type RefreshResult =
  | IssuedCliCredential
  | { error: 'unknown' | 'reuse' | 'expired' | 'idp_disabled' | 'idp_unreachable' }

type Holder = Pick<SessionUser, 'sub' | 'iss' | 'email' | 'name'>

export type CliCredentialDeps = {
  clock: Clock
  idp: (user: Pick<SessionUser, 'sub' | 'iss'>) => Promise<IdpAccess>
  /** Ends the Principal's web sessions. Logout calls this after revoking the CLI family. */
  endWebSessions?: (user: Pick<SessionUser, 'sub' | 'iss'>) => Promise<void>
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function newSecret(): string {
  return `mice_cli_${randomBytes(24).toString('base64url')}`
}

/** Short-lived CLI credentials. Raw tokens are returned once; only their hashes are stored. */
export function createCliCredentials(deps: CliCredentialDeps) {
  const { clock } = deps

  async function issue(user: Holder, scopes?: CliCredentialScope[]): Promise<IssuedCliCredential> {
    const now = clock.now()
    const familyId = randomBytes(16).toString('hex')
    const accessToken = newSecret()
    const refreshToken = newSecret()
    const accessExpires = new Date(now + CLI_ACCESS_TTL_SEC * 1000)
    const familyExpires = new Date(now + FAMILY_TTL_MS)
    await getDb().transaction(async (tx) => {
      await tx.insert(cliCredentialFamilies).values({
        id: familyId,
        iss: user.iss,
        sub: user.sub,
        email: user.email,
        name: user.name,
        scopes: scopes?.length ? scopes : null,
        createdAt: new Date(now),
        expiresAt: familyExpires,
      })
      await tx.insert(cliCredentialTokens).values([
        { tokenHash: hashToken(accessToken), familyId, kind: 'access', expiresAt: accessExpires },
        { tokenHash: hashToken(refreshToken), familyId, kind: 'refresh', expiresAt: familyExpires },
      ])
    })
    return { accessToken, refreshToken, expiresIn: CLI_ACCESS_TTL_SEC }
  }

  async function resolve(accessToken: string): Promise<SessionUser | null> {
    const now = clock.now()
    const [row] = await getDb()
      .select({
        kind: cliCredentialTokens.kind,
        tokenExpires: cliCredentialTokens.expiresAt,
        familyExpires: cliCredentialFamilies.expiresAt,
        revokedAt: cliCredentialFamilies.revokedAt,
        sub: cliCredentialFamilies.sub,
        iss: cliCredentialFamilies.iss,
        email: cliCredentialFamilies.email,
        name: cliCredentialFamilies.name,
        scopes: cliCredentialFamilies.scopes,
      })
      .from(cliCredentialTokens)
      .innerJoin(cliCredentialFamilies, eq(cliCredentialFamilies.id, cliCredentialTokens.familyId))
      .where(eq(cliCredentialTokens.tokenHash, hashToken(accessToken.trim())))
    if (!row || row.kind !== 'access' || row.revokedAt) return null
    if (row.tokenExpires.getTime() <= now || row.familyExpires.getTime() <= now) return null
    return {
      sub: row.sub,
      iss: row.iss,
      email: row.email,
      name: row.name,
      ...(row.scopes?.length ? { patScopes: row.scopes } : {}),
    }
  }

  async function refresh(refreshToken: string): Promise<RefreshResult> {
    const now = clock.now()
    const hash = hashToken(refreshToken.trim())
    return getDb().transaction(async (tx) => {
      const [row] = await tx
        .select({
          kind: cliCredentialTokens.kind,
          familyId: cliCredentialTokens.familyId,
          tokenExpires: cliCredentialTokens.expiresAt,
          usedAt: cliCredentialTokens.usedAt,
          revokedAt: cliCredentialFamilies.revokedAt,
          sub: cliCredentialFamilies.sub,
          iss: cliCredentialFamilies.iss,
        })
        .from(cliCredentialTokens)
        .innerJoin(cliCredentialFamilies, eq(cliCredentialFamilies.id, cliCredentialTokens.familyId))
        .where(eq(cliCredentialTokens.tokenHash, hash))
        .for('update')
      if (!row || row.kind !== 'refresh') return { error: 'unknown' }
      if (row.usedAt || row.revokedAt) {
        if (!row.revokedAt) {
          await tx
            .update(cliCredentialFamilies)
            .set({ revokedAt: new Date(now) })
            .where(eq(cliCredentialFamilies.id, row.familyId))
        }
        return { error: 'reuse' }
      }
      if (row.tokenExpires.getTime() <= now) return { error: 'expired' }
      const access = await deps.idp({ sub: row.sub, iss: row.iss })
      if (access === 'unreachable') return { error: 'idp_unreachable' }
      if (access !== 'enabled') return { error: 'idp_disabled' }
      await tx
        .update(cliCredentialTokens)
        .set({ usedAt: new Date(now) })
        .where(eq(cliCredentialTokens.tokenHash, hash))
      const accessToken = newSecret()
      const nextRefresh = newSecret()
      await tx.insert(cliCredentialTokens).values([
        {
          tokenHash: hashToken(accessToken),
          familyId: row.familyId,
          kind: 'access',
          expiresAt: new Date(now + CLI_ACCESS_TTL_SEC * 1000),
        },
        {
          tokenHash: hashToken(nextRefresh),
          familyId: row.familyId,
          kind: 'refresh',
          expiresAt: row.tokenExpires,
        },
      ])
      return { accessToken, refreshToken: nextRefresh, expiresIn: CLI_ACCESS_TTL_SEC }
    })
  }

  async function revoke(accessToken: string): Promise<{ sub: string; iss: string } | null> {
    const hash = hashToken(accessToken.trim())
    const [row] = await getDb()
      .select({
        kind: cliCredentialTokens.kind,
        familyId: cliCredentialTokens.familyId,
        sub: cliCredentialFamilies.sub,
        iss: cliCredentialFamilies.iss,
        revokedAt: cliCredentialFamilies.revokedAt,
      })
      .from(cliCredentialTokens)
      .innerJoin(cliCredentialFamilies, eq(cliCredentialFamilies.id, cliCredentialTokens.familyId))
      .where(eq(cliCredentialTokens.tokenHash, hash))
    if (!row || row.kind !== 'access') return null
    if (!row.revokedAt) {
      await getDb()
        .update(cliCredentialFamilies)
        .set({ revokedAt: new Date(clock.now()) })
        .where(eq(cliCredentialFamilies.id, row.familyId))
    }
    return { sub: row.sub, iss: row.iss }
  }

  async function logout(accessToken: string): Promise<boolean> {
    const user = await revoke(accessToken)
    if (!user) return false
    await deps.endWebSessions?.(user)
    return true
  }

  async function listForUser(user: Pick<Holder, 'iss' | 'sub'>) {
    const rows = await getDb()
      .select({
        id: cliCredentialFamilies.id,
        createdAt: cliCredentialFamilies.createdAt,
        expiresAt: cliCredentialFamilies.expiresAt,
      })
      .from(cliCredentialFamilies)
      .where(and(
        eq(cliCredentialFamilies.iss, user.iss),
        eq(cliCredentialFamilies.sub, user.sub),
        isNull(cliCredentialFamilies.revokedAt),
      ))
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    }))
  }

  async function revokeFamily(user: Pick<Holder, 'iss' | 'sub'>, familyId: string): Promise<boolean> {
    const [row] = await getDb()
      .update(cliCredentialFamilies)
      .set({ revokedAt: new Date(clock.now()) })
      .where(and(
        eq(cliCredentialFamilies.id, familyId),
        eq(cliCredentialFamilies.iss, user.iss),
        eq(cliCredentialFamilies.sub, user.sub),
        isNull(cliCredentialFamilies.revokedAt),
      ))
      .returning({ id: cliCredentialFamilies.id })
    return !!row
  }

  async function revokeAllFor(user: Pick<Holder, 'iss' | 'sub'>): Promise<void> {
    await getDb()
      .update(cliCredentialFamilies)
      .set({ revokedAt: new Date(clock.now()) })
      .where(and(
        eq(cliCredentialFamilies.iss, user.iss),
        eq(cliCredentialFamilies.sub, user.sub),
        isNull(cliCredentialFamilies.revokedAt),
      ))
  }

  async function listHolders() {
    const rows = await getDb()
      .select({
        sub: cliCredentialFamilies.sub,
        iss: cliCredentialFamilies.iss,
        email: cliCredentialFamilies.email,
        name: cliCredentialFamilies.name,
      })
      .from(cliCredentialFamilies)
      .where(isNull(cliCredentialFamilies.revokedAt))
    return rows
  }

  return { issue, resolve, refresh, revoke, logout, listForUser, revokeFamily, revokeAllFor, listHolders }
}

async function endWebSessions(user: Pick<SessionUser, 'sub' | 'iss'>): Promise<void> {
  const [principal] = await getDb()
    .select({ id: principals.id })
    .from(principals)
    .where(and(eq(principals.iss, user.iss), eq(principals.sub, user.sub)))
  if (!principal) return
  await getDb().delete(webSessions).where(eq(webSessions.principalId, principal.id))
}

const live = createCliCredentials({
  clock: currentClock,
  idp: async (user) => {
    const account = await directoryNow().userStatus(user.sub)
    if (account.status === 'error') return 'unreachable'
    if (account.status !== 'enabled' || !account.name.trim()) return 'disabled'
    return 'enabled'
  },
  endWebSessions,
})

export const issueCliCredential = live.issue
export const resolveCliCredential = live.resolve
export const refreshCliCredential = live.refresh
export const revokeCliCredential = live.revoke
export const logoutCliCredential = live.logout
export const listCliCredentials = live.listForUser
export const revokeCliCredentialFamily = live.revokeFamily
export const revokeAllCliCredentials = live.revokeAllFor
export const listCliCredentialHolders = live.listHolders
