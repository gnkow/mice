import '../../db/testSchema.js'
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

  await it('a configured IdP user signs in and /auth/me returns that identity', async () => {
    const app = createAuthTestApp({
      users: [{ sub: 'alice', email: 'alice@example.com', name: 'Alice' }],
    })

    // Start login flow
    const loginResp = await app.bff.request('/auth/login')
    assert.equal(loginResp.status, 302, 'login should redirect to IdP')
    
    // Extract state from redirect and PKCE cookie
    const redirectUrl = new URL(loginResp.headers.get('location')!)
    const state = redirectUrl.searchParams.get('state')!
    const pkceCookie = loginResp.headers.get('set-cookie')!
    
    // Simulate IdP callback with a valid code
    const code = app.issueAuthCode('alice', state)
    const callbackResp = await app.bff.request(`/auth/callback?code=${code}&state=${state}`, {
      headers: { cookie: pkceCookie },
    })
    assert.equal(callbackResp.status, 302, 'callback should redirect after success')
    
    // Extract session cookie
    const sessionCookie = callbackResp.headers.get('set-cookie')!
    
    // Call /auth/me with the session
    const meResp = await app.bff.request('/auth/me', {
      headers: { cookie: sessionCookie },
    })
    assert.equal(meResp.status, 200)
    
    const identity = await meResp.json()
    assert.equal(identity.sub, 'alice')
    assert.equal(identity.email, 'alice@example.com')
    assert.equal(identity.name, 'Alice')
  })

  await it('login state expires after 10 minutes', async () => {
    const app = createAuthTestApp({
      users: [{ sub: 'bob', email: 'bob@example.com', name: 'Bob' }],
    })

    // Start login flow
    const loginResp = await app.bff.request('/auth/login')
    const redirectUrl = new URL(loginResp.headers.get('location')!)
    const state = redirectUrl.searchParams.get('state')!
    const pkceCookie = loginResp.headers.get('set-cookie')!
    
    // Advance clock by 11 minutes
    app.clock.advance(11 * 60 * 1000)
    
    // Attempt callback - should fail due to expired state
    const code = app.issueAuthCode('bob', state)
    const callbackResp = await app.bff.request(`/auth/callback?code=${code}&state=${state}`, {
      headers: { cookie: pkceCookie },
    })
    
    assert.equal(callbackResp.status, 400, 'callback should reject expired login state')
    const html = await callbackResp.text()
    assert.ok(html.includes('expired') || html.includes('Invalid'), 'error message should mention expiration')
  })
})
