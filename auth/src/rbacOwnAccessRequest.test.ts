import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensurePrincipal } from './authentication/session/session.js'
import { getOwnPendingAccessRequest, submitAccessRequest } from './rbacAccessRequests.js'

const person = (sub: string) => ({
  sub,
  iss: 'https://idp.test',
  email: `${sub}@example.com`,
  name: sub,
})

describe('RBAC S34 own pending access request', () => {
  it('returns null when the user has no pending request', async () => {
    const u = person('own-none')
    await ensurePrincipal(u)
    assert.equal(await getOwnPendingAccessRequest(u), null)
  })

  it('returns the caller\'s pending request after submit', async () => {
    const u = person('own-pending')
    await ensurePrincipal(u)
    const submitted = await submitAccessRequest({
      user: u,
      message: 'need more',
      requestedRole: 'manager',
    })
    assert.equal(submitted.ok, true)
    if (!submitted.ok) throw new Error('submit failed')
    const own = await getOwnPendingAccessRequest(u)
    assert.ok(own)
    assert.equal(own!.id, submitted.request.id)
    assert.equal(own!.requestedRole, 'manager')
    assert.equal(own!.status, 'pending')
  })
})
