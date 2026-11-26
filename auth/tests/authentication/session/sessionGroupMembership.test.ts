import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createFakeDirectory } from '../../../src/packages/authentication/lib/directory/directoryFake.js'
import {
  fetchDirectoryGroupsForSession,
  formatSessionGroupMembership,
} from '../../../src/packages/authentication/lib/session/sessionGroupMembership.js'

describe('formatSessionGroupMembership', () => {
  it('returns empty when session has no groups', () => {
    assert.deepEqual(formatSessionGroupMembership(undefined, new Map()), [])
    assert.deepEqual(formatSessionGroupMembership([], new Map()), [])
  })

  it('prefers cached display names and sorts by name', () => {
    const display = new Map([
      [
        'https://idp.example.com|zzz',
        { displayName: 'Zebra Team', idBased: true },
      ],
      [
        'https://idp.example.com|aaa',
        { displayName: 'Alpha Team', idBased: true },
      ],
    ])
    assert.deepEqual(
      formatSessionGroupMembership(
        ['https://idp.example.com|zzz', 'https://idp.example.com|aaa'],
        display,
      ),
      [
        { bindingKey: 'https://idp.example.com|aaa', displayName: 'Alpha Team' },
        { bindingKey: 'https://idp.example.com|zzz', displayName: 'Zebra Team' },
      ],
    )
  })

  it('falls back to group id when display name is missing', () => {
    assert.deepEqual(
      formatSessionGroupMembership(['https://idp.example.com|eng'], new Map()),
      [{ bindingKey: 'https://idp.example.com|eng', displayName: 'eng' }],
    )
  })
})

describe('fetchDirectoryGroupsForSession', () => {
  it('refuses when directory is unconfigured', async () => {
    const directory = createFakeDirectory({ configured: false })
    assert.deepEqual(
      await fetchDirectoryGroupsForSession(
        { sub: 'alice', iss: 'https://idp.example.com' },
        directory,
      ),
      { ok: false, reason: 'unconfigured' },
    )
  })

  it('returns binding keys from directory groups', async () => {
    const issuer = 'https://idp.example.com'
    const directory = createFakeDirectory({
      configured: true,
      issuer,
      userGroups: { alice: ['eng', 'ops'] },
    })
    const fetched = await fetchDirectoryGroupsForSession(
      { sub: 'alice', iss: issuer },
      directory,
    )
    assert.equal(fetched.ok, true)
    if (!fetched.ok) return
    assert.deepEqual(fetched.bindingKeys, [`${issuer}|eng`, `${issuer}|ops`])
  })
})
