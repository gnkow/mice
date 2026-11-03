import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensurePrincipal } from './authentication/session/session.js'
import { submitAccessRequest } from './rbacAccessRequests.js'

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
