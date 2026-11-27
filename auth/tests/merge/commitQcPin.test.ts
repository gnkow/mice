import '../../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from '../../src/packages/shared/lib/testSupport.js'

/**
 * Seam: assertPinAllowed — Invalid is soft (ADR 0009).
 */
const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const { markCommitsQc } = await import('../../src/packages/merge/lib/commitQcStore.js')
const { assertPinAllowed } = await import('../../src/packages/merge/lib/commitQcPin.js')

const root = t.person('root')
await t.grantRole(root, 'manager')
assert.equal((await createNamespaceAuthz(root, 'pin-lab', 'none')).ok, true)
const repo = await ensureRepository('pin-lab', 'data')
assert.ok(repo)

describe('assertPinAllowed (ADR 0009 soft Invalid)', () => {
  it('allows unset, valid, and invalid', async () => {
    await assertPinAllowed(repo.id, 'pin-unset')

    await markCommitsQc(repo.id, ['pin-valid'], 'valid')
    await assertPinAllowed(repo.id, 'pin-valid')

    await markCommitsQc(repo.id, ['pin-invalid'], 'invalid')
    await assertPinAllowed(repo.id, 'pin-invalid')
  })
})
