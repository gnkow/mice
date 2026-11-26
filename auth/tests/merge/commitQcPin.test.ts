import '../../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from '../../src/packages/shared/lib/testSupport.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../../src/packages/authz/lib/repositoryStore.js')
const { markCommitsQc } = await import('../../src/packages/merge/lib/commitQcStore.js')
const { assertPinAllowed, PinRefusedError } = await import(
  '../../src/packages/merge/lib/commitQcPin.js'
)

const root = t.person('root')
await t.grantRole(root, 'manager')
assert.equal((await createNamespaceAuthz(root, 'pin-lab', 'none')).ok, true)
const repo = await ensureRepository('pin-lab', 'data')
assert.ok(repo)

describe('assertPinAllowed (commit QC pin gate)', () => {
  it('allows none, marked, and passed', async () => {
    await assertPinAllowed(repo.id, 'pin-none')

    await markCommitsQc(repo.id, ['pin-marked'], 'marked')
    await assertPinAllowed(repo.id, 'pin-marked')

    await markCommitsQc(repo.id, ['pin-passed'], 'passed')
    await assertPinAllowed(repo.id, 'pin-passed')
  })

  it('refuses QC Failed', async () => {
    await markCommitsQc(repo.id, ['pin-failed'], 'failed')
    await assert.rejects(
      () => assertPinAllowed(repo.id, 'pin-failed'),
      (err: unknown) => {
        assert.ok(err instanceof PinRefusedError)
        assert.match(err.message, /QC Failed/i)
        assert.equal(err.status, 409)
        return true
      },
    )
  })
})
