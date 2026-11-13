import './db/testSchema.js'
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
const { createApp } = await import('./app.js')
const { setUpstreamFetch } = await import('./proxy.js')
const { preparePrincipal } = await import('./authz.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { readRepository } = await import('./repositoryStore.js')

const admin = iso.admin
await preparePrincipal(admin)
await iso.grantRole(admin, 'manager')
await createNamespaceAuthz(admin, 'rid-ns', 'none', true)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const app = createApp()
let restoreUpstream: () => void

afterEach(() => restoreUpstream?.())

describe('proxied repo create exposes repository_id', () => {
  it('stamps the AuthZ stable id onto a successful create response', async () => {
    restoreUpstream = setUpstreamFetch(async () =>
      new Response(
        JSON.stringify({
          status: 'success',
          repository: { namespace: 'rid-ns', name: 'study', repo_uuid: 'oxen-uuid' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const res = await app.request('/api/repos', {
      method: 'POST',
      headers: {
        ...(await iso.sessionHeaders(admin)),
        'content-type': 'application/json',
        'x-mice-reason': 'Routine test change',
        'x-mice-reason-category': 'privileged_settings',
        'x-mice-change-control-id': 'CC-2026-114',
      },
      body: JSON.stringify({ namespace: 'rid-ns', name: 'study' }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      repository_id?: string
      repository?: { repository_id?: string; repo_uuid?: string }
    }
    const stored = await readRepository('rid-ns', 'study')
    assert.ok(stored)
    assert.match(body.repository_id!, UUID_RE)
    assert.equal(body.repository_id, stored.id)
    assert.equal(body.repository?.repository_id, stored.id)
    assert.equal(body.repository?.repo_uuid, 'oxen-uuid')
  })
})
