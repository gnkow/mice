import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'bootstrap@mice.local' })

import './db/testSchema.js'

const { preparePrincipal, isPendingUser } = await import('./authz.js')
const { runPrincipalBootstrap } = await import('./principalBootstrap.js')
const { hasInstancePermission, isInstanceAdmin } = await import('./authzInstanceStore.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { listNamespaceMembers, setNamespaceGroupMember } = await import('./authzMembershipStore.js')
const { getUserRole } = await import('./rbacStore.js')
const { env } = await import('./env.js')
const { matchesBootstrap } = await import('./authzRepository.js')

after(() => iso.restore())

const bootstrapAdmin = {
  sub: 'boot',
  iss: 'test',
  email: 'bootstrap@mice.local',
  emailVerified: true,
  name: 'Bootstrap',
}

const groupedStranger = {
  sub: 'grouped-stranger',
  iss: 'test',
  email: 'grouped-stranger@example.com',
  name: 'Grouped Stranger',
  groups: ['super-admins', 'engineering', 'owners'],
}

describe('principal bootstrap (#11): IdP groups never autoprovision', () => {
  it('env no longer exposes AUTHZ_GROUP_BOOTSTRAP', () => {
    assert.equal('authzGroupBootstrap' in env, false)
    assert.equal('AUTHZ_GROUP_BOOTSTRAP' in process.env, false)
  })

  it('preparePrincipal delegates only to allowlist bootstrap', async () => {
    assert.equal(matchesBootstrap(groupedStranger), false)
    assert.equal(await runPrincipalBootstrap(groupedStranger), false)
    await preparePrincipal(groupedStranger)
    assert.equal(await getUserRole(groupedStranger), null)
    assert.equal(await isPendingUser(groupedStranger), true)
    assert.equal(await isInstanceAdmin(groupedStranger), false)
    assert.equal(await hasInstancePermission(groupedStranger, 'create_namespace'), false)
  })

  it('IdP groups do not create namespace user membership via preparePrincipal', async () => {
    await preparePrincipal(bootstrapAdmin)
    assert.equal(await isInstanceAdmin(bootstrapAdmin), true)

    const ns = 'no-group-autoprovision'
    assert.deepEqual(await createNamespaceAuthz(bootstrapAdmin, ns, 'none', true), { ok: true })
    assert.deepEqual(await setNamespaceGroupMember(ns, 'engineering', 'member'), { ok: true })

    await preparePrincipal(groupedStranger)

    const members = await listNamespaceMembers(ns)
    assert.equal(
      members.some((m) => m.kind === 'user' && m.sub === groupedStranger.sub),
      false,
    )
    assert.equal(await getUserRole(groupedStranger), null)
    assert.equal(await isPendingUser(groupedStranger), true)
  })

  it('AUTHZ_BOOTSTRAP_ADMINS still grants Admin without IdP groups', async () => {
    const bare = {
      sub: 'bare-admin',
      iss: 'test',
      email: 'bootstrap@mice.local',
      emailVerified: true,
      name: 'Bare Admin',
    }
    assert.equal(matchesBootstrap(bare), true)
    assert.equal(await runPrincipalBootstrap(bare), true)
    assert.equal(await getUserRole(bare), 'admin')
    assert.equal(await isInstanceAdmin(bare), true)
  })
})
