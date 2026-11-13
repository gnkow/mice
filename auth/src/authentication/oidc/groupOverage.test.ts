import '../../db/testSchema.js'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hasGroupOverage, claimsFromPayload } from './oidcClaims.js'
import { fetchGroupsOnOverage, resolveGroupOverage } from './groupOverage.js'
import { createFakeDirectory } from '../directory/directoryFake.js'
import type { OidcClaims } from './oidcClaims.js'

/**
 * Group Overage Handling Tests (Ticket 18, U17)
 * 
 * Verifies:
 * - Overage detection in Entra ID claims (_claim_names.groups)
 * - Directory API group fetching
 * - Login succeeds with fetched groups
 * - Login fails explicitly only when directory fetch also fails
 */

describe('Group Overage Detection (Ticket 18, U17)', () => {
  it('detects Entra overage indicator (_claim_names.groups)', () => {
    const payload = {
      sub: 'alice123',
      iss: 'https://idp.example.com',
      email: 'alice@example.com',
      name: 'Alice Smith',
      _claim_names: {
        groups: 'src1'
      },
      _claim_sources: {
        src1: {
          endpoint: 'https://graph.microsoft.com/v1.0/users/alice123/getMemberObjects'
        }
      }
    }

    const overage = hasGroupOverage(payload, 'groups')
    assert.equal(overage, true)
  })

  it('does not detect overage when groups claim is present', () => {
    const payload = {
      sub: 'bob456',
      iss: 'https://idp.example.com',
      email: 'bob@example.com',
      name: 'Bob Jones',
      groups: ['eng', 'admin']
    }

    const overage = hasGroupOverage(payload, 'groups')
    assert.equal(overage, false)
  })

  it('does not detect overage for normal user without groups', () => {
    const payload = {
      sub: 'charlie789',
      iss: 'https://idp.example.com',
      email: 'charlie@example.com',
      name: 'Charlie Brown'
    }

    const overage = hasGroupOverage(payload, 'groups')
    assert.equal(overage, false)
  })

  it('claimsFromPayload marks overage and returns empty groups', () => {
    const payload = {
      sub: 'alice123',
      iss: 'https://idp.example.com',
      email: 'alice@example.com',
      name: 'Alice Smith',
      email_verified: true,
      _claim_names: {
        groups: 'src1'
      }
    }

    const claims = claimsFromPayload(payload, {
      idToken: 'fake-token',
      fallbackIssuer: 'https://idp.example.com',
      groupsClaim: 'groups',
    })

    assert.equal(claims.groupsOverage, true)
    assert.deepEqual(claims.groups, [])
  })

  it('claimsFromPayload extracts groups normally when no overage', () => {
    const payload = {
      sub: 'bob456',
      iss: 'https://idp.example.com',
      email: 'bob@example.com',
      name: 'Bob Jones',
      email_verified: true,
      groups: ['eng', 'admin']
    }

    const claims = claimsFromPayload(payload, {
      idToken: 'fake-token',
      fallbackIssuer: 'https://idp.example.com',
      groupsClaim: 'groups',
    })

    assert.equal(claims.groupsOverage, undefined)
    assert.equal(claims.groupsNameBasedFallback, true)
    assert.deepEqual(claims.groups, [
      'https://idp.example.com|eng',
      'https://idp.example.com|admin',
    ])
  })
})

describe('Directory API Group Fetching (Ticket 18, U17)', () => {
  it('fetches groups from directory when overage detected', async () => {
    const claims: OidcClaims = {
      sub: 'alice123',
      iss: 'https://idp.example.com',
      email: 'alice@example.com',
      name: 'Alice Smith',
      idToken: 'fake-token',
      groups: [],
      emailVerified: true,
      groupsOverage: true,
    }

    const directory = createFakeDirectory({
      configured: true,
      issuer: 'https://idp.example.com',
      userGroups: {
        alice123: ['eng', 'admin', 'qa', 'security', 'platform']
      }
    })

    const groups = await fetchGroupsOnOverage(claims, directory)
    assert.equal(groups.length, 5)
    assert.ok(groups.includes('https://idp.example.com|eng'))
    assert.ok(groups.includes('https://idp.example.com|admin'))
  })

  it('returns empty array when directory not configured', async () => {
    const claims: OidcClaims = {
      sub: 'bob456',
      iss: 'https://idp.example.com',
      email: 'bob@example.com',
      name: 'Bob Jones',
      idToken: 'fake-token',
      groups: [],
      emailVerified: true,
      groupsOverage: true,
    }

    const directory = createFakeDirectory({
      configured: false
    })

    const groups = await fetchGroupsOnOverage(claims, directory)
    assert.deepEqual(groups, [])
  })

  it('returns empty array when directory fetch fails', async () => {
    const claims: OidcClaims = {
      sub: 'charlie789',
      iss: 'https://idp.example.com',
      email: 'charlie@example.com',
      name: 'Charlie Brown',
      idToken: 'fake-token',
      groups: [],
      emailVerified: true,
      groupsOverage: true,
    }

    const directory = createFakeDirectory({
      configured: true,
      issuer: 'https://idp.example.com',
      userGroups: {} // No groups for this user
    })

    const groups = await fetchGroupsOnOverage(claims, directory)
    assert.deepEqual(groups, [])
  })

  it('returns existing groups when no overage', async () => {
    const claims: OidcClaims = {
      sub: 'dave999',
      iss: 'https://idp.example.com',
      email: 'dave@example.com',
      name: 'Dave Wilson',
      idToken: 'fake-token',
      groups: ['eng', 'admin'],
      emailVerified: true,
    }

    const directory = createFakeDirectory({
      configured: true,
      issuer: 'https://idp.example.com',
    })

    const groups = await fetchGroupsOnOverage(claims, directory)
    assert.deepEqual(groups, ['eng', 'admin'])
  })
})

describe('Group Overage Resolution (Ticket 18, U17)', () => {
  it('resolves overage by fetching and updating claims', async () => {
    const claims: OidcClaims = {
      sub: 'alice123',
      iss: 'https://idp.example.com',
      email: 'alice@example.com',
      name: 'Alice Smith',
      idToken: 'fake-token',
      groups: [],
      emailVerified: true,
      groupsOverage: true,
    }

    const directory = createFakeDirectory({
      configured: true,
      issuer: 'https://idp.example.com',
      userGroups: {
        alice123: ['eng', 'admin', 'qa']
      }
    })

    const success = await resolveGroupOverage(claims, directory)
    assert.equal(success, true)
    assert.deepEqual(claims.groups, [
      'https://idp.example.com|eng',
      'https://idp.example.com|admin',
      'https://idp.example.com|qa',
    ])
    assert.equal(claims.groupsOverage, undefined)
  })

  it('returns false when overage detected but fetch fails', async () => {
    const claims: OidcClaims = {
      sub: 'bob456',
      iss: 'https://idp.example.com',
      email: 'bob@example.com',
      name: 'Bob Jones',
      idToken: 'fake-token',
      groups: [],
      emailVerified: true,
      groupsOverage: true,
    }

    const directory = createFakeDirectory({
      configured: true,
      issuer: 'https://idp.example.com',
      userGroups: {} // No groups for this user = fetch failure
    })

    const success = await resolveGroupOverage(claims, directory)
    assert.equal(success, false)
    assert.deepEqual(claims.groups, [])
    assert.equal(claims.groupsOverage, true) // Still marked as overage
  })

  it('returns true when no overage detected', async () => {
    const claims: OidcClaims = {
      sub: 'charlie789',
      iss: 'https://idp.example.com',
      email: 'charlie@example.com',
      name: 'Charlie Brown',
      idToken: 'fake-token',
      groups: ['eng'],
      emailVerified: true,
    }

    const directory = createFakeDirectory({
      configured: true,
      issuer: 'https://idp.example.com',
    })

    const success = await resolveGroupOverage(claims, directory)
    assert.equal(success, true)
    assert.deepEqual(claims.groups, ['eng'])
  })

  it('returns false when directory getUserGroups throws', async () => {
    const claims: OidcClaims = {
      sub: 'erin111',
      iss: 'https://idp.example.com',
      email: 'erin@example.com',
      name: 'Erin Lee',
      idToken: 'fake-token',
      groups: [],
      emailVerified: true,
      groupsOverage: true,
    }
    const base = createFakeDirectory({
      configured: true,
      issuer: 'https://idp.example.com',
    })
    const directory = {
      ...base,
      async getUserGroups() {
        throw new Error('directory unavailable')
      },
    }

    assert.equal(await resolveGroupOverage(claims, directory), false)
    assert.equal(claims.groupsOverage, true)
    assert.deepEqual(claims.groups, [])
  })

  it('does not call the directory when groups are already in the token', async () => {
    let directoryCalls = 0
    const claims: OidcClaims = {
      sub: 'dave999',
      iss: 'https://idp.example.com',
      email: 'dave@example.com',
      name: 'Dave Wilson',
      idToken: 'fake-token',
      groups: ['https://idp.example.com|eng'],
      emailVerified: true,
    }
    const base = createFakeDirectory({
      configured: true,
      issuer: 'https://idp.example.com',
      userGroups: { dave999: ['should-not-be-fetched'] },
    })
    const directory = {
      ...base,
      async getUserGroups(sub: string) {
        directoryCalls += 1
        return base.getUserGroups(sub)
      },
    }

    assert.equal(await resolveGroupOverage(claims, directory), true)
    assert.equal(directoryCalls, 0)
    assert.deepEqual(claims.groups, ['https://idp.example.com|eng'])
  })
})
