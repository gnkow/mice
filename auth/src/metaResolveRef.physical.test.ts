import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createOwnedRepository } from './authzRepository.js'
import { ensureNamespaceForCreate } from './authzNamespaceStore.js'
import { resolveRef } from './metaRoutes.js'

describe('resolveRef with AuthZ display names (physical oxen keys)', () => {
  it('accepts a repository that exists in AuthZ even when oxen is not at the display path', async () => {
    const ns = `meta-phys-${Date.now().toString(36)}`
    await ensureNamespaceForCreate(
      {
        sub: 'a0000000-0000-4000-8000-000000000001',
        iss: 'http://localhost:8180/realms/mice',
        email: 'admin@mice.local',
        name: 'Admin',
      },
      ns,
      'none',
    )
    const repo = await createOwnedRepository(
      ns,
      'sample',
      'http://localhost:8180/realms/mice|a0000000-0000-4000-8000-000000000001',
    )
    assert.ok(repo)

    // Display path is AuthZ-only; oxen lives under UUID keys, so a naive
    // /api/repos/{ns}/{name} probe 404s. resolveRef must still succeed.
    const ref = await resolveRef('repo', `${ns}/sample`)
    assert.equal(ref.type, 'repo')
    assert.equal(ref.namespace, ns)
    assert.equal(ref.repo, 'sample')
  })
})
