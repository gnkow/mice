import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateLiveIdpAccess } from './idpCheck.js'
import type { DirectoryUserState } from '../directory/directory.js'

const user = {
  sub: 'alice',
  iss: 'https://idp.test',
  email: 'alice@test.io',
  name: 'Alice',
}

describe('evaluateLiveIdpAccess (Ticket 19)', () => {
  it('allows an enabled IdP user with a display name', async () => {
    const lookup = async (): Promise<DirectoryUserState> => ({
      status: 'enabled',
      name: 'Ada Lovelace',
    })
    const result = await evaluateLiveIdpAccess(user, lookup)
    assert.deepEqual(result, {
      ok: true,
      reachable: true,
      account: { status: 'enabled', name: 'Ada Lovelace' },
    })
  })

  it('returns 503 when the directory is unreachable', async () => {
    const lookup = async (): Promise<DirectoryUserState> => ({
      status: 'error',
      name: '',
    })
    const result = await evaluateLiveIdpAccess(user, lookup)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 503)
    assert.equal(result.reachable, false)
    assert.match(result.error, /Service Unavailable|IdP/i)
  })

  it('returns 503 when the user is disabled', async () => {
    const lookup = async (): Promise<DirectoryUserState> => ({
      status: 'disabled',
      name: 'Ada',
    })
    const result = await evaluateLiveIdpAccess(user, lookup)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 503)
    assert.equal(result.reachable, true)
    assert.equal(result.disabled, true)
  })

  it('returns 403 when the enabled user has no IdP display name', async () => {
    const lookup = async (): Promise<DirectoryUserState> => ({
      status: 'enabled',
      name: '   ',
    })
    const result = await evaluateLiveIdpAccess(user, lookup)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 403)
    assert.equal(result.error, 'Your account has no name in the identity provider.')
  })

  it('treats a thrown lookup as unreachable', async () => {
    const lookup = async (): Promise<DirectoryUserState> => {
      throw new Error('network down')
    }
    const result = await evaluateLiveIdpAccess(user, lookup)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.reachable, false)
    assert.equal(result.status, 503)
  })
})
