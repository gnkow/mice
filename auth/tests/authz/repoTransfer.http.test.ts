import '../db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { isolatedAuth, regulatedMutationHeaders } from '../../src/packages/shared/lib/testSupport.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { Hono } = await import('hono')
const { registerNamespaceRoutes } = await import('../../src/packages/namespaces/lib/namespaceRoutes.js')
const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const { sealedSessionCookie } = await import('../../src/packages/shared/lib/testSupport.js')
const { openSignatureStore, useSignatureStore } = await import(
  '../../src/packages/authentication/lib/signing/signatureStore.js'
)
const { immudbConfig, openLedger } = await import('../../src/packages/audit/lib/auditLedger.js')
const { createOwnedRepository, readRepository } = await import(
  '../../src/packages/authz/lib/repositoryStore.js'
)
const { setRepoCollaborator } = await import('../../src/packages/authz/lib/authzCollaboratorStore.js')
const { userKey } = await import('../../src/packages/authz/lib/authzTypes.js')
const { proxyToOxen, setUpstreamFetch } = await import('../../src/packages/proxy/lib/proxy.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({ ...immudbConfig(), prefix: `esign-xfer/${randomBytes(4).toString('hex')}/` }),
  ),
)

const root = { ...t.person('root'), email: 'root@x.io', emailVerified: true as const }
const srcOwner = t.person('src-owner')
const destOwner = t.person('dest-owner')
const outsider = t.person('outsider')
const repoAdmin = t.person('repo-admin')

await preparePrincipal(root)
await preparePrincipal(srcOwner)
await preparePrincipal(destOwner)
await preparePrincipal(outsider)
await preparePrincipal(repoAdmin)
await t.grantRole(srcOwner, 'manager')
await t.grantRole(destOwner, 'manager')
await t.grantRole(outsider, 'user')
await t.grantRole(repoAdmin, 'user')

const audits: Array<{ action: string; detail?: Record<string, unknown> }> = []
const app = new Hono()
registerNamespaceRoutes(app, {
  audit: async (_c, _u, _via, f) => {
    audits.push({ action: f.action, detail: f.detail })
  },
})

const personFor = (sub: string) => {
  if (sub === 'root') return root
  if (sub === 'src-owner') return srcOwner
  if (sub === 'dest-owner') return destOwner
  if (sub === 'repo-admin') return repoAdmin
  return outsider
}

const cookie = async (sub: string) =>
  sealedSessionCookie({ ...personFor(sub), sessionStart: Math.floor(Date.now() / 1000) })

const call = async (
  as: string,
  method: string,
  path: string,
  body?: unknown,
  opts?: { reasonOnly?: boolean },
) => {
  const headers = opts?.reasonOnly
    ? {
        'content-type': 'application/json',
        'x-mice-reason': 'Routine transfer decision for assay batch',
        'x-mice-change-control-id': 'CC-2026-114',
      }
    : await regulatedMutationHeaders(personFor(as), {
        method,
        path,
        body: body ?? {},
      })
  return app.request(path, {
    method,
    headers: {
      ...headers,
      cookie: await cookie(as),
      ...(opts?.reasonOnly ? {} : { 'x-mice-change-control-id': 'CC-2026-114' }),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

async function seedNamespaces() {
  assert.equal(
    (await call('src-owner', 'POST', '/auth/namespaces', { name: 'xfer-http-src', basePermission: 'none' }))
      .status,
    200,
  )
  assert.equal(
    (
      await call('dest-owner', 'POST', '/auth/namespaces', {
        name: 'xfer-http-dst',
        basePermission: 'none',
      })
    ).status,
    200,
  )
  assert.ok(await createOwnedRepository('xfer-http-src', 'study', userKey(srcOwner)))
  await setRepoCollaborator('xfer-http-src', 'study', repoAdmin, 'admin')
}

describe('repository transfer HTTP', () => {
  it('permission matrix: source Owner proposes; dest Owner accepts; outsider and repo admin refused', async () => {
    await seedNamespaces()

    assert.equal(
      (
        await call('outsider', 'POST', '/auth/namespaces/xfer-http-src/repos/study/transfer', {
          targetNamespace: 'xfer-http-dst',
        })
      ).status,
      403,
    )
    assert.equal(
      (
        await call('repo-admin', 'POST', '/auth/namespaces/xfer-http-src/repos/study/transfer', {
          targetNamespace: 'xfer-http-dst',
        })
      ).status,
      403,
    )

    const proposed = await call('src-owner', 'POST', '/auth/namespaces/xfer-http-src/repos/study/transfer', {
      targetNamespace: 'xfer-http-dst',
    })
    assert.equal(proposed.status, 200)
    const proposedBody = (await proposed.json()) as { mode: string }
    assert.equal(proposedBody.mode, 'pending')
    assert.ok(audits.some((a) => a.action === 'repo.transfer'))

    assert.equal(
      (
        await call('outsider', 'POST', '/auth/namespaces/xfer-http-src/repos/study/transfer/accept', {})
      ).status,
      403,
    )
    assert.equal(
      (
        await call('src-owner', 'POST', '/auth/namespaces/xfer-http-src/repos/study/transfer/accept', {})
      ).status,
      403,
    )

    const accepted = await call(
      'dest-owner',
      'POST',
      '/auth/namespaces/xfer-http-src/repos/study/transfer/accept',
      {},
    )
    assert.equal(accepted.status, 200)
    assert.ok(audits.some((a) => a.action === 'repo.transfer.accept'))
    assert.ok(await readRepository('xfer-http-dst', 'study'))
    assert.equal(await readRepository('xfer-http-src', 'study'), null)
  })

  it('one-shots when source Owner is also dest Owner; reject/cancel need reason only', async () => {
    assert.equal(
      (
        await call('src-owner', 'POST', '/auth/namespaces', {
          name: 'xfer-both',
          basePermission: 'none',
        })
      ).status,
      200,
    )
    assert.equal(
      (
        await call('dest-owner', 'POST', '/auth/namespaces', {
          name: 'xfer-reject-dst',
          basePermission: 'none',
        })
      ).status,
      200,
    )
    assert.ok(await createOwnedRepository('xfer-http-src', 'solo', userKey(srcOwner)))
    // src-owner is Owner of xfer-http-src from seed; add as Owner of xfer-both and transfer into it.
    assert.ok(await createOwnedRepository('xfer-both', 'owned', userKey(srcOwner)))

    const oneShot = await call('src-owner', 'POST', '/auth/namespaces/xfer-both/repos/owned/transfer', {
      targetNamespace: 'xfer-http-src',
    })
    assert.equal(oneShot.status, 200)
    const oneShotBody = (await oneShot.json()) as { mode: string }
    assert.equal(oneShotBody.mode, 'one-shot')

    assert.ok(await createOwnedRepository('xfer-http-src', 'cancel-me', userKey(srcOwner)))
    assert.equal(
      (
        await call('src-owner', 'POST', '/auth/namespaces/xfer-http-src/repos/cancel-me/transfer', {
          targetNamespace: 'xfer-reject-dst',
        })
      ).status,
      200,
    )
    const cancelled = await call(
      'src-owner',
      'POST',
      '/auth/namespaces/xfer-http-src/repos/cancel-me/transfer/cancel',
      {},
      { reasonOnly: true },
    )
    assert.equal(cancelled.status, 200)
    assert.ok(audits.some((a) => a.action === 'repo.transfer.cancel'))

    assert.equal(
      (
        await call('src-owner', 'POST', '/auth/namespaces/xfer-http-src/repos/cancel-me/transfer', {
          targetNamespace: 'xfer-reject-dst',
        })
      ).status,
      200,
    )
    const rejected = await call(
      'dest-owner',
      'POST',
      '/auth/namespaces/xfer-http-src/repos/cancel-me/transfer/reject',
      {},
      { reasonOnly: true },
    )
    assert.equal(rejected.status, 200)
    assert.ok(audits.some((a) => a.action === 'repo.transfer.reject'))
  })

  it('refuses oxen PATCH …/transfer with oxen_transfer_refused', async () => {
    const proxyApp = new Hono()
    proxyApp.all('/api/*', async (c) =>
      proxyToOxen(c, { user: srcOwner, via: 'session' }),
    )
    const restore = setUpstreamFetch(async () => {
      throw new Error('oxen must not be contacted for transfer')
    })
    try {
      const path = '/api/repos/xfer-http-src/study/transfer'
      // study may already have moved; ensure a repo exists for path interpretation
      assert.ok(await createOwnedRepository('xfer-http-src', 'block-oxen', userKey(srcOwner)))
      const transferPath = '/api/repos/xfer-http-src/block-oxen/transfer'
      const signed = await regulatedMutationHeaders(srcOwner, {
        method: 'PATCH',
        path: transferPath,
        body: { namespace: 'xfer-http-dst' },
      })
      const res = await proxyApp.request(transferPath, {
        method: 'PATCH',
        headers: {
          ...signed,
          cookie: await cookie('src-owner'),
          'x-mice-change-control-id': 'CC-2026-114',
        },
        body: JSON.stringify({ namespace: 'xfer-http-dst' }),
      })
      assert.equal(res.status, 400)
      const body = (await res.json()) as { error?: { code?: string } }
      assert.equal(body.error?.code, 'oxen_transfer_refused')
      void path
    } finally {
      restore()
    }
  })
})
