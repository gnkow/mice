import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { evaluateLiveIdpAccess, settleLiveIdpAccess } from './idpCheck.js'
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
      kind: 'allowed',
      account: { status: 'enabled', name: 'Ada Lovelace' },
    })
  })

  it('returns unreachable when the directory is unreachable', async () => {
    const lookup = async (): Promise<DirectoryUserState> => ({
      status: 'error',
      name: '',
    })
    const result = await evaluateLiveIdpAccess(user, lookup)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'unreachable')
    assert.equal(result.status, 503)
    assert.match(result.error, /Service Unavailable|IdP/i)
  })

  it('returns disabled when the user is disabled', async () => {
    const lookup = async (): Promise<DirectoryUserState> => ({
      status: 'disabled',
      name: 'Ada',
    })
    const result = await evaluateLiveIdpAccess(user, lookup)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'disabled')
    assert.equal(result.status, 503)
  })

  it('returns missing when the Principal is absent from the directory', async () => {
    const lookup = async (): Promise<DirectoryUserState> => ({
      status: 'missing',
      name: '',
    })
    const result = await evaluateLiveIdpAccess(user, lookup)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'missing')
    assert.equal(result.status, 503)
    assert.match(result.error, /Service Unavailable|IdP/i)
  })

  it('returns nameless when the enabled user has no IdP display name', async () => {
    const lookup = async (): Promise<DirectoryUserState> => ({
      status: 'enabled',
      name: '   ',
    })
    const result = await evaluateLiveIdpAccess(user, lookup)
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.kind, 'nameless')
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
    assert.equal(result.kind, 'unreachable')
    assert.equal(result.status, 503)
  })
})

describe('settleLiveIdpAccess (Ticket 19)', () => {
  it('records reachability and disabled side effects keyed by kind', async () => {
    const checks: Array<{ reachable: boolean; check?: string }> = []
    const disabled: string[] = []

    const unreachable = await settleLiveIdpAccess(user, {
      lookup: async () => ({ status: 'error', name: '' }),
      now: () => 1_700_000_000_000,
      requestId: 'req-1',
      recordCheck: async (input) => {
        checks.push({
          reachable: input.reachable,
          ...(input.check ? { check: input.check } : {}),
        })
      },
      recordDisabled: async (principal) => {
        disabled.push(principal.sub)
      },
    })
    assert.equal(unreachable.ok, false)
    if (!unreachable.ok) assert.equal(unreachable.kind, 'unreachable')
    assert.deepEqual(checks, [{ reachable: false, check: 'authenticated-request' }])
    assert.deepEqual(disabled, [])

    checks.length = 0
    const disabledUser = await settleLiveIdpAccess(user, {
      lookup: async () => ({ status: 'disabled', name: 'Ada' }),
      now: () => 1_700_000_000_001,
      recordCheck: async (input) => {
        checks.push({ reachable: input.reachable })
      },
      recordDisabled: async (principal) => {
        disabled.push(principal.sub)
      },
    })
    assert.equal(disabledUser.ok, false)
    if (disabledUser.ok) return
    assert.equal(disabledUser.kind, 'disabled')
    assert.deepEqual(checks, [{ reachable: true }])
    assert.deepEqual(disabled, ['alice'])

    checks.length = 0
    disabled.length = 0
    const missing = await settleLiveIdpAccess(user, {
      lookup: async () => ({ status: 'missing', name: '' }),
      recordCheck: async (input) => {
        checks.push({ reachable: input.reachable })
      },
      recordDisabled: async (principal) => {
        disabled.push(principal.sub)
      },
    })
    assert.equal(missing.ok, false)
    if (!missing.ok) assert.equal(missing.kind, 'missing')
    assert.deepEqual(checks, [{ reachable: true }])
    assert.deepEqual(disabled, [])
  })
})
