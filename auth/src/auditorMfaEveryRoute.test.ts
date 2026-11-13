import './db/testSchema.js'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { isolatedAuth, withMfa } from './testSupport.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
const { createApp } = await import('./app.js')
const { setUpstreamFetch } = await import('./proxy.js')
const { preparePrincipal } = await import('./authz.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')

await preparePrincipal(iso.admin)
await createNamespaceAuthz(iso.admin, 'mfa-ns', 'none', true)
const auditor = iso.person('mfa-auditor')
await preparePrincipal(auditor)
await iso.grantRole(auditor, 'auditor')

const app = createApp()
let restoreUpstream: () => void
beforeEach(() => {
  restoreUpstream = setUpstreamFetch(
    async () => new Response('{"status":"ok"}', { status: 200, headers: { 'content-type': 'application/json' } }),
  )
})
afterEach(() => restoreUpstream())

const REASON = 'Auditor access requires MFA evidence'
const PATHS: Array<[string, string, string, BodyInit?]> = [
  ['instance', 'GET', '/auth/audit'],
  ['namespace', 'GET', '/auth/namespaces'],
  ['repo', 'GET', '/api/repos/mfa-ns/data'],
  ['lineage', 'GET', '/auth/lineage?namespace=mfa-ns&repo=data&path=a.csv'],
]

describe('Auditor MFA on every decision path (#17)', () => {
  for (const [path, method, url, body] of PATHS) {
    it(`refuses an Auditor session without MFA on the ${path} path, and serves it with MFA`, async () => {
      const call = async (user: typeof auditor) =>
        app.request(url, {
          method,
          headers: { ...(await iso.sessionHeaders(user)), 'content-type': 'application/json' },
          body,
        })
      const refused = await call(auditor)
      assert.equal(refused.status, 403)
      assert.match(await refused.text(), new RegExp(REASON))
      assert.notEqual((await call(withMfa(auditor))).status, 403)
    })
  }

  it('refuses signing for an Auditor with or without MFA (#13)', async () => {
    const call = async (user: typeof auditor) =>
      app.request('/auth/sign/prepare', {
        method: 'POST',
        headers: { ...(await iso.sessionHeaders(user)), 'content-type': 'application/json' },
        body: '{}',
      })
    const noMfa = await call(auditor)
    assert.equal(noMfa.status, 403)
    assert.match(await noMfa.text(), new RegExp(REASON))
    const withEvidence = await call(withMfa(auditor))
    assert.equal(withEvidence.status, 403)
    assert.match(await withEvidence.text(), /Auditor role cannot sign/)
  })

  it('still lets an Auditor without MFA read /auth/me so the UI can explain', async () => {
    assert.equal((await app.request('/auth/me', { headers: await iso.sessionHeaders(auditor) })).status, 200)
  })

  it('refuses an Auditor PAT without MFA on an instance path with the same reason', async () => {
    const { issueCliCredential } = await import('./authentication/credentials/cliCredentials.js')
    const { accessToken } = await issueCliCredential(auditor)
    const refused = await app.request('/auth/audit', {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    assert.equal(refused.status, 403)
    assert.match(await refused.text(), new RegExp(REASON))
  })
})
