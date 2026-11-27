import '../../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { randomBytes } from 'node:crypto'
import { Hono } from 'hono'
import {
  isolatedAuth,
  regulatedMutationHeaders,
  sealedSessionCookie,
} from '../../src/packages/shared/lib/testSupport.js'

/**
 * Seam: POST /auth/repos/:ns/:repo/commits/disposition (ADR 0009 Slice C).
 * Catches: write+ non-author Valid OK; author Valid refused; Invalid self OK.
 */
const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const { setRepoCollaborator } = await import('../../src/packages/authz/lib/authzCollaboratorStore.js')
const { registerMergeRequestRoutes } = await import('../../src/packages/merge/lib/mergeRequestRoutes.js')
const { getCommitQc, recordCommitAttribution } = await import('../../src/packages/merge/index.js')
const { openSignatureStore, useSignatureStore } = await import(
  '../../src/packages/authentication/lib/signing/signatureStore.js'
)
const { immudbConfig, openLedger } = await import('../../src/packages/audit/lib/auditLedger.js')
const { signerAuthorKey } = await import('../../src/packages/authentication/principal.js')

useSignatureStore(
  openSignatureStore(
    await openLedger({
      ...immudbConfig(),
      prefix: `disp-http/${randomBytes(4).toString('hex')}/`,
    }),
  ),
)

const writer = t.person('disp-writer')
await preparePrincipal(writer)
await t.grantRole(writer, 'user')
assert.equal((await createNamespaceAuthz(writer, 'disp-http', 'none')).ok, true)
const repo = await ensureRepository('disp-http', 'assay')
assert.ok(repo)
await setRepoCollaborator('disp-http', 'assay', writer, 'write')

const author = t.person('disp-author')
await preparePrincipal(author)
await t.grantRole(author, 'user')
await setRepoCollaborator('disp-http', 'assay', author, 'write')

const app = new Hono()
registerMergeRequestRoutes(app, { audit: async () => {} })

const cookie = async (u: typeof writer) =>
  sealedSessionCookie({ ...u, sessionStart: Math.floor(Date.now() / 1000) })

describe('POST commits/disposition (ADR 0009)', () => {
  it('writer non-author can Valid a commit', async () => {
    await recordCommitAttribution('disp-other', {
      author: 'https://idp|someone-else',
      email: 'else@x.io',
    })
    const path = '/auth/repos/disp-http/assay/commits/disposition'
    const body = { disposition: { 'disp-other': 'valid' } }
    const headers = await regulatedMutationHeaders(writer, {
      method: 'POST',
      path,
      body,
      reason: 'Writer dispositions a non-authored commit Valid',
    })
    const res = await app.request(path, {
      method: 'POST',
      headers: { ...headers, cookie: await cookie(writer) },
      body: JSON.stringify(body),
    })
    const json = (await res.json()) as { code?: string; error?: string }
    assert.equal(res.status, 200, JSON.stringify(json))
    assert.equal(await getCommitQc(repo.id, 'disp-other'), 'valid')
  })

  it('author Valid is refused; Invalid is allowed', async () => {
    const commitId = 'disp-own'
    await recordCommitAttribution(commitId, {
      author: signerAuthorKey(author),
      email: 'author@x.io',
    })
    const path = '/auth/repos/disp-http/assay/commits/disposition'
    const validBody = { disposition: { [commitId]: 'valid' } }
    const validHeaders = await regulatedMutationHeaders(author, {
      method: 'POST',
      path,
      body: validBody,
      reason: 'Author tries to Valid their own commit',
    })
    const refused = await app.request(path, {
      method: 'POST',
      headers: { ...validHeaders, cookie: await cookie(author) },
      body: JSON.stringify(validBody),
    })
    assert.equal(refused.status, 403)
    assert.equal(((await refused.json()) as { code?: string }).code, 'self_valid')
    assert.equal(await getCommitQc(repo.id, commitId), 'unset')

    const invBody = { disposition: { [commitId]: 'invalid' } }
    const invHeaders = await regulatedMutationHeaders(author, {
      method: 'POST',
      path,
      body: invBody,
      reason: 'Author Invalids their own commit',
    })
    const ok = await app.request(path, {
      method: 'POST',
      headers: { ...invHeaders, cookie: await cookie(author) },
      body: JSON.stringify(invBody),
    })
    assert.equal(ok.status, 200, await ok.clone().text())
    assert.equal(await getCommitQc(repo.id, commitId), 'invalid')
  })
})
