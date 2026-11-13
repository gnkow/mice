import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createAuthTestApp } from './authTestApp.js'

/**
 * Table-driven authentication test suite.
 * 
 * This suite demonstrates the standard pattern for auth testing:
 * 1. Define test users with their attributes
 * 2. Create an app with a fake IdP and controllable clock
 * 3. Run table-driven scenarios against the IdP
 * 
 * The fake IdP issues real JWT tokens that can be decoded and verified.
 * The clock can be advanced to test time-based scenarios like expiration.
 */
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

  await it('contract: tokens include standard OIDC claims', async () => {
    const app = createAuthTestApp({
      users: [{ sub: 'charlie', email: 'charlie@example.com', name: 'Charlie' }],
    })

    const token = await app.idp.issueToken('charlie')
    const claims = await app.idp.decodeToken(token)
    
    // Standard OIDC claims
    assert.ok(claims.sub, 'token must include sub')
    assert.ok(claims.iss, 'token must include iss')
    assert.ok(claims.aud, 'token must include aud')
    assert.ok(claims.iat, 'token must include iat')
    assert.ok(claims.exp, 'token must include exp')
    
    // User profile claims
    assert.ok(claims.email, 'token must include email')
    assert.ok(claims.name, 'token must include name')
    
    // Expiration should be in the future relative to issue time
    assert.ok(claims.exp > claims.iat, 'exp must be after iat')
  })

  await it('signIn completes login and /auth/me returns that identity', async () => {
    const app = createAuthTestApp({
      users: [{ sub: 'alice', email: 'alice@example.com', name: 'Alice' }],
    })

    const { sessionCookie } = await app.signIn('alice')

    const meResp = await app.bff.request('/auth/me', {
      headers: { cookie: sessionCookie },
    })
    assert.equal(meResp.status, 200)

    const identity = await meResp.json()
    assert.equal(identity.sub, 'alice')
    assert.equal(identity.email, 'alice@example.com')
    assert.equal(identity.name, 'Alice')
  })

  await it('signIn seals the session against the harness clock', async () => {
    const app = createAuthTestApp({
      users: [{ sub: 'dana', email: 'dana@example.com', name: 'Dana' }],
    })

    const offsetMs = 3 * 60 * 60 * 1000
    app.clock.advance(offsetMs)
    const expectedSat = Math.floor(app.clock.now() / 1000)

    const { sessionCookie } = await app.signIn('dana')
    const claims = await app.readSession(sessionCookie)

    assert.equal(claims.sub, 'dana')
    assert.equal(claims.sat, expectedSat)
    assert.equal(claims.act, expectedSat)
  })

  await it('signIn fails when login state expires after 10 minutes', async () => {
    const app = createAuthTestApp({
      users: [{ sub: 'bob', email: 'bob@example.com', name: 'Bob' }],
    })

    const loginResp = await app.bff.request('/auth/login')
    assert.equal(loginResp.status, 302)

    app.clock.advance(11 * 60 * 1000)

    await assert.rejects(
      () => app.signIn('bob', { reuseLogin: loginResp }),
      (err: Error) => {
        assert.ok(/expired|Invalid/i.test(err.message))
        return true
      },
    )
  })

  await it('a callback replayed after signIn is rejected', async () => {
    const app = createAuthTestApp({
      users: [{ sub: 'charlie', email: 'charlie@example.com', name: 'Charlie' }],
    })

    const first = await app.signIn('charlie')
    assert.ok(first.sessionCookie)

    const replay = await app.bff.request(first.callbackUrl, {
      headers: { cookie: first.pkceCookie },
    })
    assert.equal(replay.status, 400, 'replayed callback should be rejected')

    const html = await replay.text()
    assert.ok(html.includes('Invalid') || html.includes('expired') || html.includes('used'), 'error should indicate replay')
  })
})
