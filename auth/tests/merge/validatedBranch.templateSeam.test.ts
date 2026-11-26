import '../../src/db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from '../../src/packages/shared/lib/testSupport.js'

/**
 * Seam: template / seed onto validated tip (#116).
 * Catches: empty-default create seeds validated main; unsigned tip seed is refused by the gate;
 *          no template install path seeds files onto the validated tip.
 * Misses: full template-install product (MR open + signed complete) — not built yet.
 */
const iso = isolatedAuth()
after(() => iso.restore())

const { preparePrincipal } = await import('../../src/packages/authz/lib/authz.js')
const { createNamespaceAuthz } = await import('../../src/packages/authz/lib/authzNamespaceStore.js')
const { seedRepoCreate } = await import('../../src/packages/proxy/lib/proxyEffects.js')
const {
  decideUnsignedTemplateSeed,
  listValidatedBranches,
} = await import('../../src/packages/merge/index.js')

describe('template / empty-default validated seam (#116)', () => {
  it('repo create seeds empty default as validated; unsigned seed onto it is refused', async () => {
    const owner = iso.person('vb-tpl')
    await preparePrincipal(owner)
    await iso.grantRole(owner, 'manager')
    assert.equal((await createNamespaceAuthz(owner, 'vb-tpl', 'none')).ok, true)

    const seeded = await seedRepoCreate(owner, 'vb-tpl', 'from-template')
    assert.ok(seeded)
    const validated = await listValidatedBranches(seeded.repositoryId)
    assert.deepEqual(validated, ['main'])

    const seed = decideUnsignedTemplateSeed({
      targetBranch: 'main',
      validatedBranches: validated,
    })
    assert.equal(seed.allow, false)

    // Seeding onto a non-validated working branch remains allowed (then MR into default).
    assert.equal(
      decideUnsignedTemplateSeed({
        targetBranch: 'template-work',
        validatedBranches: validated,
      }).allow,
      true,
    )
  })
})
