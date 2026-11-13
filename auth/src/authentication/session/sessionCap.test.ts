import '../../db/testSchema.js'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { sealSession, ensurePrincipal, type SessionUser } from './session.js'
import {
  enforceWebSessionCap,
  sessionToEvictForCap,
  WEB_SESSION_CAP,
} from './sessionCap.js'
import { getDb } from '../../db/database.js'
import { webSessions } from '../../db/schema.js'
import { eq } from 'drizzle-orm'
import { queryAudit } from '../../audit.js'

const hashId = (id: string) => createHash('sha256').update(id).digest('hex')

/**
 * Session Cap and Eviction Tests (Ticket 15)
 *
 * Part 11 §11.300(b) requires authority checks. Unlimited sessions create
 * enforcement problems (stolen cookies, concurrent access from impossible locations).
 *
 * Round 8 decision U4: Cap at 5 concurrent sessions per Principal.
 *
 * Related:
 * - .scratch/authentication/issues/15-session-cap-and-eviction.md
 * - Round 8 decision U4
 */

const mk = (sub: string, opts?: Partial<SessionUser>): SessionUser => ({
  sub,
  iss: 'https://idp.test',
  email: `${sub}@test.io`,
  name: sub,
  sessionStart: Math.floor(Date.now() / 1000) - 30,
  ...opts,
})

describe('sessionToEvictForCap', () => {
  it('returns null when under the cap', () => {
    const rows = [
      { idHash: 'a', sessionStart: 1 },
      { idHash: 'b', sessionStart: 2 },
    ]
    assert.equal(sessionToEvictForCap(rows, WEB_SESSION_CAP), null)
    assert.equal(sessionToEvictForCap(rows, 5), null)
  })

  it('returns the oldest row when at the cap', () => {
    const rows = [1, 2, 3, 4, 5].map((n) => ({ idHash: `h${n}`, sessionStart: n }))
    assert.deepEqual(sessionToEvictForCap(rows, 5), { idHash: 'h1', sessionStart: 1 })
  })

  it('returns the oldest row when over the cap', () => {
    const rows = [1, 2, 3, 4, 5, 6].map((n) => ({ idHash: `h${n}`, sessionStart: n }))
    assert.deepEqual(sessionToEvictForCap(rows, 5), { idHash: 'h1', sessionStart: 1 })
  })
})

describe('Session Cap and Eviction', () => {
  it('allows creating up to 5 sessions for same Principal', async () => {
    const user = mk('alice')
    
    // Create 5 sessions
    const sessions = []
    for (let i = 0; i < 5; i++) {
      const sessionId = await sealSession(user)
      sessions.push(sessionId)
    }

    // All 5 should exist
    const count = await getDb()
      .select({ count: webSessions.principalId })
      .from(webSessions)
      .where(eq(webSessions.principalId, 1)) // alice's principalId

    assert.equal(count.length, 5)
  })

  it('evicts oldest session when creating 6th session', async () => {
    const user = mk('bob')
    
    // Create 5 sessions with different sessionStart times
    const sessions = []
    for (let i = 0; i < 5; i++) {
      const sessionId = await sealSession({
        ...user,
        sessionStart: Math.floor(Date.now() / 1000) - (100 - i * 10), // Oldest first
      })
      sessions.push(sessionId)
    }

    // Create 6th session - should evict the oldest
    const sixthSession = await sealSession({
      ...user,
      sessionStart: Math.floor(Date.now() / 1000) - 5,
    })

    // Should still have only 5 sessions total
    const allSessions = await getDb()
      .select()
      .from(webSessions)

    const bobSessions = allSessions.filter(s => s.email === 'bob@test.io')
    assert.equal(bobSessions.length, 5)

    // Oldest session (first one created) should be gone
    const oldestExists = await getDb()
      .select()
      .from(webSessions)
      .where(eq(webSessions.idHash, hashId(sessions[0])))

    assert.equal(oldestExists.length, 0)

    // Newest session should exist
    const newestExists = await getDb()
      .select()
      .from(webSessions)
      .where(eq(webSessions.idHash, hashId(sixthSession)))

    assert.equal(newestExists.length, 1)
  })

  it('does not evict sessions from different Principals', async () => {
    const alice = mk('alice2')
    const bob = mk('bob2')

    // Create 5 sessions for alice
    for (let i = 0; i < 5; i++) {
      await sealSession(alice)
    }

    // Create 5 sessions for bob
    for (let i = 0; i < 5; i++) {
      await sealSession(bob)
    }

    // Both should have 5 sessions each
    const allSessions = await getDb().select().from(webSessions)
    const aliceSessions = allSessions.filter(s => s.email === 'alice2@test.io')
    const bobSessions = allSessions.filter(s => s.email === 'bob2@test.io')

    assert.equal(aliceSessions.length, 5)
    assert.equal(bobSessions.length, 5)
  })

  it('evicts based on sessionStart (oldest timestamp)', async () => {
    const user = mk('charlie')
    
    // Create sessions with specific timestamps
    const now = Math.floor(Date.now() / 1000)
    const timestamps = [
      now - 100, // oldest
      now - 80,
      now - 60,
      now - 40,
      now - 20,  // newest of the first 5
    ]

    for (const ts of timestamps) {
      await sealSession({ ...user, sessionStart: ts })
    }

    // Create 6th with newest timestamp
    await sealSession({ ...user, sessionStart: now - 5 })

    // Should evict the one with timestamp (now - 100)
    const remaining = await getDb()
      .select()
      .from(webSessions)
      .where(eq(webSessions.email, 'charlie@test.io'))

    assert.equal(remaining.length, 5)

    // Verify oldest is gone by checking sessionStart values
    const sessionStarts = remaining.map(s => s.sessionStart).sort()
    assert.ok(!sessionStarts.includes(now - 100))
    assert.ok(sessionStarts.includes(now - 5))
  })

  it('writes session.evict with evicted hash and reason cap-exceeded', async () => {
    const user = mk('diana')
    const sessions: string[] = []
    for (let i = 0; i < 5; i++) {
      sessions.push(
        await sealSession({
          ...user,
          sessionStart: Math.floor(Date.now() / 1000) - (100 - i * 10),
        }),
      )
    }
    await sealSession({ ...user, sessionStart: Math.floor(Date.now() / 1000) - 5 })

    const { events } = await queryAudit({ action: 'session.evict', limit: 20 })
    const eviction = events.find(
      (e) => e.detail?.evictedSessionHash === hashId(sessions[0]!),
    )
    assert.ok(eviction, 'expected session.evict for oldest session')
    assert.equal(eviction.detail?.reason, 'cap-exceeded')
    assert.equal(eviction.detail?.cap, WEB_SESSION_CAP)
  })

  it('enforceWebSessionCap returns the evicted row (no audit side-channel required)', async () => {
    const user = mk('evan-return')
    const principalId = await ensurePrincipal(user)
    const sessions: string[] = []
    for (let i = 0; i < WEB_SESSION_CAP; i++) {
      sessions.push(
        await sealSession({
          ...user,
          sessionStart: Math.floor(Date.now() / 1000) - (100 - i * 10),
        }),
      )
    }
    const result = await enforceWebSessionCap({
      principalId,
      actor: { sub: user.sub, iss: user.iss, email: user.email, name: user.name },
    })
    assert.ok(result.evicted, 'expected an eviction at the cap')
    assert.equal(result.evicted.idHash, hashId(sessions[0]!))
    assert.equal(
      (
        await enforceWebSessionCap({
          principalId,
          actor: { sub: user.sub, iss: user.iss, email: user.email, name: user.name },
        })
      ).evicted,
      null,
      'under cap after one eviction',
    )
  })
})
