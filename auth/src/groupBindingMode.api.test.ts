import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth, regulatedMutationHeaders } from './testSupport.js'
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
const {
  checkGroupBindingMode,
  getGroupBindingStatus,
} = await import('./groupBindingStatusStore.js')

const app = createApp()
const admin = iso.admin
await preparePrincipal(admin)

after(() => iso.restore())

async function checkHeaders(body: { sampleGroups: string[] }) {
  const signed = await regulatedMutationHeaders(admin, {
    method: 'POST',
    path: '/auth/instance/group-binding/check',
    body,
    reason: 'Validate group binding mode for the instance',
    category: 'privileged_settings',
  })
  return {
    ...(await iso.sessionHeaders(admin)),
    ...signed,
    'x-mice-change-control-id': 'CC-2026-114',
  }
}

describe('checkGroupBindingMode store seam', () => {
  it('persists id-based and name-based assessments with warning from mode', async () => {
    const idBased = await checkGroupBindingMode(['11111111-1111-4111-8111-111111111111'])
    assert.equal(idBased.mode, 'id-based')
    assert.equal(idBased.warning, false)
    assert.equal(idBased.message, GROUP_BINDING_ID_BASED_MESSAGE)
    assert.ok(idBased.checkedAt)

    const stored = await getGroupBindingStatus()
    assert.equal(stored.mode, 'id-based')
    assert.equal(stored.warning, false)

    const named = await checkGroupBindingMode(['Quality Team'])
    assert.equal(named.mode, 'name-based')
    assert.equal(named.warning, true)
    assert.equal((await getGroupBindingStatus()).warning, true)
  })
})

describe('instance group-binding validation API', () => {
  it('reports id-based mode after a check with Azure-style GUID samples', async () => {
    const body = { sampleGroups: ['11111111-1111-4111-8111-111111111111'] }
    const res = await app.request('/auth/instance/group-binding/check', {
      method: 'POST',
      headers: await checkHeaders(body),
      body: JSON.stringify(body),
    })
    assert.equal(res.status, 200)
    const json = (await res.json()) as { mode: string; message: string; warning: boolean }
    assert.equal(json.mode, 'id-based')
    assert.equal(json.message, GROUP_BINDING_ID_BASED_MESSAGE)
    assert.equal(json.warning, false)

    const get = await app.request('/auth/instance/group-binding', {
      headers: await iso.sessionHeaders(admin),
    })
    assert.equal(get.status, 200)
    const stored = (await get.json()) as { mode: string; message: string }
    assert.equal(stored.mode, 'id-based')
    assert.equal(stored.message, GROUP_BINDING_ID_BASED_MESSAGE)
  })

  it('persists a name-based warning when samples lack object ids', async () => {
    const body = { sampleGroups: ['Quality Team'] }
    const res = await app.request('/auth/instance/group-binding/check', {
      method: 'POST',
      headers: await checkHeaders(body),
      body: JSON.stringify(body),
    })
    assert.equal(res.status, 200)
    const json = (await res.json()) as { mode: string; message: string; warning: boolean }
    assert.equal(json.mode, 'name-based')
    assert.equal(json.message, GROUP_BINDING_NAME_BASED_MESSAGE)
    assert.equal(json.warning, true)
  })

  it('detects Keycloak object ids as id-based', async () => {
    const body = { sampleGroups: ['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'] }
    const res = await app.request('/auth/instance/group-binding/check', {
      method: 'POST',
      headers: await checkHeaders(body),
      body: JSON.stringify(body),
    })
    assert.equal(res.status, 200)
    const json = (await res.json()) as { mode: string }
    assert.equal(json.mode, 'id-based')
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
    const json = (await res.json()) as {
      groupBindingWarning?: string
      members: Array<{ kind: string; bindingMode?: string }>
    }
    assert.equal(json.groupBindingWarning, GROUP_BINDING_NAME_BASED_MESSAGE)
    assert.ok(json.members.some((m) => m.kind === 'group' && m.bindingMode === 'name-based'))
  })
})
