import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'
import {
  GROUP_BINDING_ID_BASED_MESSAGE,
  GROUP_BINDING_NAME_BASED_MESSAGE,
} from './groupBindingMode.js'

const iso = isolatedAuth({
  OXEN_UPSTREAM: 'http://oxen.invalid',
  OIDC_ISSUER_PUBLIC: 'http://kc.test/realms/mice',
})
const { createApp } = await import('./app.js')
const { preparePrincipal } = await import('./authz.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { setNamespaceGroupMember, listNamespaceMembers } = await import('./authzMembershipStore.js')

const app = createApp()
const admin = iso.admin
await preparePrincipal(admin)

after(() => iso.restore())

async function headers() {
  return {
    ...(await iso.sessionHeaders(admin)),
    'content-type': 'application/json',
    'x-mice-reason': 'Validate group binding mode for the instance',
  }
}

describe('instance group-binding validation API', () => {
  it('reports id-based mode after a check with Azure-style GUID samples', async () => {
    const res = await app.request('/auth/instance/group-binding/check', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({
        sampleGroups: ['11111111-1111-4111-8111-111111111111'],
      }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { mode: string; message: string; warning: boolean }
    assert.equal(body.mode, 'id-based')
    assert.equal(body.message, GROUP_BINDING_ID_BASED_MESSAGE)
    assert.equal(body.warning, false)

    const get = await app.request('/auth/instance/group-binding', {
      headers: await iso.sessionHeaders(admin),
    })
    assert.equal(get.status, 200)
    const stored = (await get.json()) as { mode: string; message: string }
    assert.equal(stored.mode, 'id-based')
    assert.equal(stored.message, GROUP_BINDING_ID_BASED_MESSAGE)
  })

  it('persists a name-based warning when samples lack object ids', async () => {
    const res = await app.request('/auth/instance/group-binding/check', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({ sampleGroups: ['Quality Team'] }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { mode: string; message: string; warning: boolean }
    assert.equal(body.mode, 'name-based')
    assert.equal(body.message, GROUP_BINDING_NAME_BASED_MESSAGE)
    assert.equal(body.warning, true)
  })

  it('detects Keycloak object ids as id-based', async () => {
    const res = await app.request('/auth/instance/group-binding/check', {
      method: 'POST',
      headers: await headers(),
      body: JSON.stringify({
        sampleGroups: ['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'],
      }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { mode: string }
    assert.equal(body.mode, 'id-based')
  })
})

describe('namespace group binding mode for owners', () => {
  it('exposes bindingMode on group members and a name-based warning', async () => {
    const ns = 'gb-mode'
    assert.equal((await createNamespaceAuthz(admin, ns, 'read', true)).ok, true)
    assert.equal(
      (
        await setNamespaceGroupMember(ns, 'quality team', 'member', {
          displayName: 'Quality Team',
        })
      ).ok,
      true,
    )
    assert.equal(
      (
        await setNamespaceGroupMember(ns, '11111111-1111-4111-8111-111111111111', 'member', {
          displayName: 'QA UUID',
        })
      ).ok,
      true,
    )

    const members = await listNamespaceMembers(ns)
    const named = members.find((m) => m.kind === 'group' && m.group.endsWith('|quality team'))
    const idBased = members.find((m) => m.kind === 'group' && m.group.includes('11111111'))
    assert.equal(named && 'bindingMode' in named ? named.bindingMode : undefined, 'name-based')
    assert.equal(idBased && 'bindingMode' in idBased ? idBased.bindingMode : undefined, 'id-based')

    const res = await app.request(`/auth/namespaces/${ns}`, {
      headers: await iso.sessionHeaders(admin),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      groupBindingWarning?: string
      members: Array<{ kind: string; bindingMode?: string }>
    }
    assert.equal(body.groupBindingWarning, GROUP_BINDING_NAME_BASED_MESSAGE)
    assert.ok(body.members.some((m) => m.kind === 'group' && m.bindingMode === 'name-based'))
  })
})
