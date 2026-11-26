import '../../../../db/testSchema.js'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hasGroupOverage, claimsFromPayload } from '../../../src/packages/authentication/lib/oidc/oidcClaims.js'
import { fetchGroupsOnOverage, resolveGroupOverage } from '../../../src/packages/authentication/lib/oidc/groupOverage.js'
import { createFakeDirectory } from '../../../src/packages/authentication/lib/directory/directoryFake.js'
import type { OidcClaims } from '../../../src/packages/authentication/lib/oidc/oidcClaims.js'

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
    assert.deepEqual(claims.groups, [])
  })
})

const ENG = '11111111-1111-4111-8111-111111111111'
const ADMIN = '22222222-2222-4222-8222-222222222222'
const QA = '33333333-3333-4333-8333-333333333333'
const SECURITY = '44444444-4444-4444-8444-444444444444'
const PLATFORM = '55555555-5555-4555-8555-555555555555'

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
        alice123: [ENG, ADMIN, QA, SECURITY, PLATFORM]
      }
    })

    const groups = await fetchGroupsOnOverage(claims, directory)
    assert.equal(groups.length, 5)
    assert.ok(groups.includes(`https://idp.example.com|${ENG}`))
    assert.ok(groups.includes(`https://idp.example.com|${ADMIN}`))
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
      groups: [ENG, ADMIN],
      emailVerified: true,
    }

    const directory = createFakeDirectory({
      configured: true,
      issuer: 'https://idp.example.com',
    })

    const groups = await fetchGroupsOnOverage(claims, directory)
    assert.deepEqual(groups, [ENG, ADMIN])
  })
})

describe('Group Overage Resolution (Ticket 18, U17)', () => {
  it('resolves overage by returning claims with bound groups (no input mutation)', async () => {
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
        alice123: [ENG, ADMIN, QA]
      }
    })

    const resolved = await resolveGroupOverage(claims, directory)
    assert.equal(resolved.ok, true)
    if (!resolved.ok) return
    assert.deepEqual(resolved.claims.groups, [
      `https://idp.example.com|${ENG}`,
      `https://idp.example.com|${ADMIN}`,
      `https://idp.example.com|${QA}`,
    ])
    assert.equal(resolved.claims.groupsOverage, undefined)
    // Input claims stay untouched
    assert.deepEqual(claims.groups, [])
    assert.equal(claims.groupsOverage, true)
  })

  it('returns typed failure when overage detected but fetch fails', async () => {
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

    const resolved = await resolveGroupOverage(claims, directory)
    assert.deepEqual(resolved, { ok: false, reason: 'empty' })
    assert.deepEqual(claims.groups, [])
    assert.equal(claims.groupsOverage, true)
  })

  it('returns ok claims when no overage detected', async () => {
    const claims: OidcClaims = {
      sub: 'charlie789',
      iss: 'https://idp.example.com',
      email: 'charlie@example.com',
      name: 'Charlie Brown',
      idToken: 'fake-token',
      groups: [ENG],
      emailVerified: true,
    }

    const directory = createFakeDirectory({
      configured: true,
      issuer: 'https://idp.example.com',
    })

    const resolved = await resolveGroupOverage(claims, directory)
    assert.equal(resolved.ok, true)
    if (!resolved.ok) return
    assert.equal(resolved.claims, claims)
    assert.deepEqual(resolved.claims.groups, [ENG])
  })

  it('returns typed failure when directory getUserGroups throws', async () => {
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

    assert.deepEqual(await resolveGroupOverage(claims, directory), {
      ok: false,
      reason: 'error',
    })
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
      groups: [`https://idp.example.com|${ENG}`],
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

    const resolved = await resolveGroupOverage(claims, directory)
    assert.equal(resolved.ok, true)
    assert.equal(directoryCalls, 0)
    assert.deepEqual(claims.groups, [`https://idp.example.com|${ENG}`])
  })

  it('treats directory name-shaped ids as empty (object ids required)', async () => {
    const claims: OidcClaims = {
      sub: 'frank',
      iss: 'https://idp.example.com',
      email: 'frank@example.com',
      name: 'Frank',
      idToken: 'fake-token',
      groups: [],
      emailVerified: true,
      groupsOverage: true,
    }
    const directory = createFakeDirectory({
      configured: true,
      issuer: 'https://idp.example.com',
      userGroups: { frank: ['engineering', 'admins'] },
    })
    assert.deepEqual(await resolveGroupOverage(claims, directory), {
      ok: false,
      reason: 'empty',
    })
  })
})
