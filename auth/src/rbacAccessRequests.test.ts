import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensurePrincipal } from './authentication/session/session.js'
import {
  assignRole,
  getCustomPermissions,
  getUserRole,
  listRoleHistory,
} from './rbacStore.js'
import {
  approveAccessRequest,
  denyAccessRequest,
  getOwnPendingAccessRequest,
  listAccessRequestsForReviewer,
  submitAccessRequest,
} from './rbacAccessRequests.js'

const person = (sub: string) => ({
  sub,
  iss: 'https://idp.test',
  email: `${sub}@example.com`,
  name: sub,
})

describe('RBAC S16 submit access request', () => {
  it('requires justification and a role or custom permissions', async () => {
    const user = person('req-empty')
    await ensurePrincipal(user)
    const noMessage = await submitAccessRequest({
      user,
      message: '   ',
      requestedRole: 'user',
    })
    assert.equal(noMessage.ok, false)
    if (noMessage.ok) throw new Error('expected failure')
    assert.match(noMessage.error, /justif|message/i)

    const nothing = await submitAccessRequest({
      user,
      message: 'please',
    })
    assert.equal(nothing.ok, false)
    if (nothing.ok) throw new Error('expected failure')
    assert.match(nothing.error, /role|permission/i)
  })

  it('creates a pending role request', async () => {
    const user = person('req-user')
    await ensurePrincipal(user)
    const result = await submitAccessRequest({
      user,
      message: 'Need write access for project work',
      requestedRole: 'user',
    })
    assert.equal(result.ok, true)
    if (!result.ok) throw new Error('expected ok')
    assert.equal(result.request.status, 'pending')
    assert.equal(result.request.requestedRole, 'user')
    assert.deepEqual(result.request.requestedPermissions, [])
    assert.equal(result.request.message, 'Need write access for project work')
    assert.equal(result.request.sub, user.sub)
  })

  it('creates a pending custom-permission request', async () => {
    const user = person('req-custom')
    await ensurePrincipal(user)
    const result = await submitAccessRequest({
      user,
      message: 'Need namespace create only',
      requestedPermissions: ['namespace:create'],
    })
    assert.equal(result.ok, true)
    if (!result.ok) throw new Error('expected ok')
    assert.equal(result.request.requestedRole, null)
    assert.deepEqual(result.request.requestedPermissions, ['namespace:create'])
  })
})

describe('RBAC S17 one pending request', () => {
  it('replaces the pending request when the user submits again', async () => {
    const user = person('req-twice')
    await ensurePrincipal(user)
    const first = await submitAccessRequest({
      user,
      message: 'first request',
      requestedRole: 'user',
    })
    assert.equal(first.ok, true)
    if (!first.ok) throw new Error('expected first submit')
    const second = await submitAccessRequest({
      user,
      message: 'second request',
      requestedRole: 'manager',
    })
    assert.equal(second.ok, true)
    if (!second.ok) throw new Error('expected replace')
    assert.equal(second.request.id, first.request.id)
    assert.equal(second.request.message, 'second request')
    assert.equal(second.request.requestedRole, 'manager')
    const own = await getOwnPendingAccessRequest(user)
    assert.equal(own?.id, first.request.id)
    assert.equal(own?.requestedRole, 'manager')
  })
})

describe('RBAC S18 list for reviewer', () => {
  it('filters pending requests by the reviewer approval authority', async () => {
    const manager = person('reviewer-mgr')
    const admin = person('reviewer-admin')
    const wantUser = person('want-user-role')
    const wantAdmin = person('want-admin-role')
    await ensurePrincipal(manager)
    await ensurePrincipal(admin)
    await ensurePrincipal(wantUser)
    await ensurePrincipal(wantAdmin)
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000
    assert.equal(
      (await assignRole({ actor: null, target: manager, role: 'manager', reason: 'boot', bootstrap: true })).ok,
      true,
    )
    assert.equal(
      (await assignRole({ actor: null, target: admin, role: 'admin', reason: 'boot', bootstrap: true })).ok,
      true,
    )
    assert.equal(
      (await submitAccessRequest({ user: wantUser, message: 'user please', requestedRole: 'user' })).ok,
      true,
    )
    assert.equal(
      (await submitAccessRequest({ user: wantAdmin, message: 'admin please', requestedRole: 'admin' })).ok,
      true,
    )

    const subjects = new Set([wantUser.sub, wantAdmin.sub])
    const forManager = (await listAccessRequestsForReviewer(manager))
      .filter((r) => subjects.has(r.sub))
    assert.deepEqual(
      forManager.map((r) => r.requestedRole).sort(),
      ['user'],
    )

    const forAdmin = (await listAccessRequestsForReviewer(admin))
      .filter((r) => subjects.has(r.sub))
    assert.deepEqual(
      forAdmin.map((r) => r.requestedRole).sort(),
      ['admin', 'user'],
    )
  })
})

describe('RBAC S19 approve access request', () => {
  it('applies the granted role immediately and links the request in history', async () => {
    const manager = person('approver-mgr')
    const applicant = person('applicant-user')
    await ensurePrincipal(manager)
    await ensurePrincipal(applicant)
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000
    assert.equal(
      (await assignRole({ actor: null, target: manager, role: 'manager', reason: 'boot', bootstrap: true })).ok,
      true,
    )
    const submitted = await submitAccessRequest({
      user: applicant,
      message: 'need user',
      requestedRole: 'user',
    })
    assert.equal(submitted.ok, true)
    if (!submitted.ok) throw new Error('submit failed')

    const approved = await approveAccessRequest({
      reviewer: manager,
      requestId: submitted.request.id,
      expiresAt,
    })
    assert.equal(approved.ok, true)
    assert.equal(await getUserRole(applicant), 'user')
    const history = await listRoleHistory(applicant)
    const grant = history.find((h) => h.action === 'granted' && h.role === 'user')
    assert.ok(grant)
    assert.equal(grant?.accessRequestId, submitted.request.id)
  })

  it('blocks a manager from approving an Admin request', async () => {
    const manager = person('approver-mgr2')
    const applicant = person('applicant-admin')
    await ensurePrincipal(manager)
    await ensurePrincipal(applicant)
    assert.equal(
      (await assignRole({ actor: null, target: manager, role: 'manager', reason: 'boot', bootstrap: true })).ok,
      true,
    )
    const submitted = await submitAccessRequest({
      user: applicant,
      message: 'need admin',
      requestedRole: 'admin',
    })
    assert.equal(submitted.ok, true)
    if (!submitted.ok) throw new Error('submit failed')
    const approved = await approveAccessRequest({
      reviewer: manager,
      requestId: submitted.request.id,
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    })
    assert.equal(approved.ok, false)
    if (approved.ok) throw new Error('expected failure')
    assert.match(approved.error, /authority|forbidden|cannot/i)
    assert.equal(await getUserRole(applicant), null)
  })

  it('applies modified role and custom permissions through the authorized grant seam', async () => {
    const manager = person('approver-modify-mgr')
    const applicant = person('applicant-modify')
    await ensurePrincipal(manager)
    await ensurePrincipal(applicant)
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000
    assert.equal(
      (await assignRole({ actor: null, target: manager, role: 'manager', reason: 'boot', bootstrap: true })).ok,
      true,
    )
    const submitted = await submitAccessRequest({
      user: applicant,
      message: 'need manager',
      requestedRole: 'manager',
    })
    assert.equal(submitted.ok, true)
    if (!submitted.ok) throw new Error('submit failed')

    const approved = await approveAccessRequest({
      reviewer: manager,
      requestId: submitted.request.id,
      expiresAt,
      grantedRole: 'user',
      grantedPermissions: ['namespace:create'],
      reason: 'subset with create',
    })
    assert.equal(approved.ok, true)
    assert.equal(await getUserRole(applicant), 'user')
    assert.deepEqual(await getCustomPermissions(applicant), ['namespace:create'])
    const grant = (await listRoleHistory(applicant)).find(
      (h) => h.action === 'granted' && h.role === 'user',
    )
    assert.equal(grant?.accessRequestId, submitted.request.id)
  })
})

describe('RBAC S20 deny access request', () => {
  it('denies with a reason and does not grant a role', async () => {
    const manager = person('denier-mgr')
    const applicant = person('denied-user')
    await ensurePrincipal(manager)
    await ensurePrincipal(applicant)
    assert.equal(
      (await assignRole({ actor: null, target: manager, role: 'manager', reason: 'boot', bootstrap: true })).ok,
      true,
    )
    const submitted = await submitAccessRequest({
      user: applicant,
      message: 'please',
      requestedRole: 'user',
    })
    assert.equal(submitted.ok, true)
    if (!submitted.ok) throw new Error('submit failed')
    const denied = await denyAccessRequest({
      reviewer: manager,
      requestId: submitted.request.id,
      reason: 'insufficient business need',
    })
    assert.equal(denied.ok, true)
    if (!denied.ok) throw new Error('deny failed')
    assert.equal(denied.request.status, 'denied')
    assert.equal(await getUserRole(applicant), null)
  })
})
