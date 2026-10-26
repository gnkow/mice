import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { fakeClock } from '../../clock.js'
import { decodeJwtPayload } from '../oidc/oidcClaims.js'
import { createOidcProvider, pkceChallenge, randomString } from '../oidc/oidc.js'
import { createFakeIdp } from './fakeIdp.js'
import type { IdpAdapter } from './idpAdapter.js'

/**
 * Seam 3: the contract every IdP adapter must satisfy, run through the production OIDC provider. Add a
 * container adapter over auth/keycloak/realm-mice.json to `adapters` to run the same table against Keycloak.
 */
const clock = fakeClock(Date.UTC(2026, 5, 1))
const adapters: Array<{ name: string; make: () => IdpAdapter }> = [{ name: 'in-process fake IdP', make: () => createFakeIdp({ clock }) }]

for (const { name, make } of adapters) {
  describe(`IdP adapter contract: ${name}`, async () => {
    const idp = make()
    idp.addUser('ann', { email: 'ann@mice.local', name: 'Ann', groups: ['devs'] })
    idp.addUser('mfa', { email: 'mfa@mice.local', mfa: true })
    idp.addUser('guest', { email: 'g@partner.example', guest: true })
    idp.addUser('nameless', { email: 'n@mice.local', name: null })
    idp.addUser('gone', { email: 'gone@mice.local', disabled: true })
    await idp.start()
    after(() => idp.stop())

    const provider = createOidcProvider(
      () => ({
        issuer: idp.issuer,
        issuerPublic: idp.issuer,
        clientId: idp.clientId,
        clientSecret: '',
        redirectUri: 'http://localhost/auth/callback',
        postLogoutRedirectUri: 'http://localhost/login',
        groupsClaim: 'groups',
        verifyIdToken: false,
        jwksCooldownMs: 0,
      }),
      { nowSec: () => Math.floor(clock.now() / 1000) },
    )

    async function signIn(key: string, authAgeSec?: number) {
      const verifier = randomString()
      const nonce = randomString()
      const url = await provider.beginLogin({
        state: 's1',
        nonce,
        codeChallenge: await pkceChallenge(verifier),
      })
      const result = await idp.signIn(key, url, { authAgeSec })
      if (!result.ok) return result
      const claims = await provider.completeLogin({ code: result.code, codeVerifier: verifier, nonce })
      return { ok: true as const, state: result.state, claims, token: decodeJwtPayload(claims.idToken) }
    }

    it('issues the configured identity and echoes state', async () => {
      const r = await signIn('ann')
      assert.ok(r.ok && 'claims' in r)
      assert.deepEqual([r.state, r.claims.sub, r.claims.email, r.claims.name, r.claims.groups], ['s1', 'ann', 'ann@mice.local', 'Ann', ['devs']])
    })

    it('distinguishes MFA from non-MFA in amr and acr', async () => {
      const plain = await signIn('ann')
      const strong = await signIn('mfa')
      assert.ok(plain.ok && 'token' in plain && strong.ok && 'token' in strong)
      assert.deepEqual([plain.token.amr, plain.token.acr], [['pwd'], 'pwd'])
      assert.deepEqual([strong.token.amr, strong.token.acr], [['pwd', 'otp'], 'mfa'])
    })

    it('marks an external guest', async () => {
      const r = await signIn('guest')
      assert.ok(r.ok && 'token' in r)
      assert.equal(r.token.guest, true)
    })

    it('omits the name claim when configured so', async () => {
      const r = await signIn('nameless')
      assert.ok(r.ok && 'token' in r)
      assert.equal('name' in r.token, false)
    })

    it('reports auth_time as IdP-now minus the requested age', async () => {
      const r = await signIn('ann', 120)
      assert.ok(r.ok && 'claims' in r)
      assert.equal(r.claims.authTime, Math.floor(clock.now() / 1000) - 120)
    })

    it('refuses a disabled user', async () => {
      const r = await signIn('gone')
      assert.deepEqual([r.ok, !r.ok && r.error], [false, 'access_denied'])
    })
  })
}
