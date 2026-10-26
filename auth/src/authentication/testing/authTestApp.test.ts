import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createAuthTestApp } from './authTestApp.js'

await describe('authTestApp', async () => {
  await it('IdP issues a token for a configured user', async () => {
    const app = createAuthTestApp({
      users: [{ sub: 'alice', email: 'alice@example.com', name: 'Alice' }],
    })

    const token = await app.idp.issueToken('alice')
    
    assert.ok(token)
    assert.equal(typeof token, 'string')
  })

  await it('clock offset can be applied to the BFF and IdP', async () => {
    const app = createAuthTestApp({
      users: [{ sub: 'bob', email: 'bob@example.com', name: 'Bob' }],
    })

    const initialTime = app.clock.now()
    
    // Advance clock by 1 hour
    app.clock.advance(60 * 60 * 1000)
    
    const laterTime = app.clock.now()
    assert.equal(laterTime - initialTime, 60 * 60 * 1000)
  })

  await it('supports table-driven suite format', async () => {
    const testCases = [
      { 
        name: 'alice can login',
        sub: 'alice', 
        email: 'alice@example.com',
        expectSuccess: true,
      },
      { 
        name: 'bob can login',
        sub: 'bob', 
        email: 'bob@example.com',
        expectSuccess: true,
      },
    ]

    const app = createAuthTestApp({
      users: testCases.map(tc => ({ sub: tc.sub, email: tc.email, name: tc.sub })),
    })

    for (const tc of testCases) {
      const token = await app.idp.issueToken(tc.sub)
      assert.ok(token, `${tc.name}: expected token`)
    }
  })

  await it('IdP issues tokens with configurable user attributes', async () => {
    const app = createAuthTestApp({
      users: [
        { sub: 'alice', email: 'alice@example.com', name: 'Alice Admin' },
        { sub: 'bob', email: 'bob@guest.com', name: 'Bob Guest' },
      ],
    })

    const aliceToken = await app.idp.issueToken('alice')
    const bobToken = await app.idp.issueToken('bob')
    
    // Tokens should contain user information
    const aliceClaims = await app.idp.decodeToken(aliceToken)
    const bobClaims = await app.idp.decodeToken(bobToken)
    
    assert.equal(aliceClaims.sub, 'alice')
    assert.equal(aliceClaims.email, 'alice@example.com')
    assert.equal(aliceClaims.name, 'Alice Admin')
    
    assert.equal(bobClaims.sub, 'bob')
    assert.equal(bobClaims.email, 'bob@guest.com')
    assert.equal(bobClaims.name, 'Bob Guest')
  })
})
