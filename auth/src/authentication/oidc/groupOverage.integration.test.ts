import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createFakeDirectory } from '../directory/directoryFake.js'
import { claimsFromPayload } from './oidcClaims.js'
import {
  fetchDirectoryGroupBindings,
  resolveGroupOverage,
} from './groupOverage.js'

/**
 * Ticket 18 integration: overage resolution at the directory-fetch package seam
 * (claimsFromPayload → fetchDirectoryGroupBindings / resolveGroupOverage).
 * Login adapts via resolveGroupOverage; this file does not share loginFlow suites.
 */

const issuer = 'https://idp.example.com'

describe('group overage directory-fetch package seam (Ticket 18)', () => {
  it('claims overage → directory fetch binds groups and clears the overage flag', async () => {
    const claims = claimsFromPayload(
      {
        sub: 'alice',
        iss: issuer,
        email: 'alice@example.com',
        name: 'Alice',
        email_verified: true,
        _claim_names: { groups: 'src1' },
      },
      { idToken: 'tok', fallbackIssuer: issuer, groupsClaim: 'groups' },
    )
    assert.equal(claims.groupsOverage, true)
    assert.deepEqual(claims.groups, [])

    const directory = createFakeDirectory({
      configured: true,
      issuer,
      userGroups: { alice: ['eng', 'admin'] },
    })

    const fetched = await fetchDirectoryGroupBindings(claims, directory)
    assert.deepEqual(fetched, {
      ok: true,
      groups: [`${issuer}|eng`, `${issuer}|admin`],
    })

    assert.equal(await resolveGroupOverage(claims, directory), true)
    assert.deepEqual(claims.groups, [`${issuer}|eng`, `${issuer}|admin`])
    assert.equal(claims.groupsOverage, undefined)
  })

  it('refuses overage resolution when the directory is unconfigured', async () => {
    const claims = claimsFromPayload(
      {
        sub: 'bob',
        iss: issuer,
        email: 'bob@example.com',
        name: 'Bob',
        _claim_names: { groups: 'src1' },
      },
      { idToken: 'tok', fallbackIssuer: issuer, groupsClaim: 'groups' },
    )
    const directory = createFakeDirectory({ configured: false, issuer })
    assert.deepEqual(await fetchDirectoryGroupBindings(claims, directory), {
      ok: false,
      reason: 'unconfigured',
    })
    assert.equal(await resolveGroupOverage(claims, directory), false)
    assert.equal(claims.groupsOverage, true)
  })

  it('refuses overage resolution when directory returns no groups', async () => {
    const claims = claimsFromPayload(
      {
        sub: 'carol',
        iss: issuer,
        email: 'carol@example.com',
        name: 'Carol',
        _claim_names: { groups: 'src1' },
      },
      { idToken: 'tok', fallbackIssuer: issuer, groupsClaim: 'groups' },
    )
    const directory = createFakeDirectory({
      configured: true,
      issuer,
      userGroups: {},
    })
    assert.deepEqual(await fetchDirectoryGroupBindings(claims, directory), {
      ok: false,
      reason: 'empty',
    })
    assert.equal(await resolveGroupOverage(claims, directory), false)
  })

  it('does not call the directory when groups are already in the token', async () => {
    let calls = 0
    const claims = claimsFromPayload(
      {
        sub: 'dave',
        iss: issuer,
        email: 'dave@example.com',
        name: 'Dave',
        groups: ['eng'],
      },
      { idToken: 'tok', fallbackIssuer: issuer, groupsClaim: 'groups' },
    )
    assert.equal(claims.groupsOverage, undefined)
    const base = createFakeDirectory({
      configured: true,
      issuer,
      userGroups: { dave: ['should-not-fetch'] },
    })
    const directory = {
      ...base,
      async getUserGroups(sub: string) {
        calls += 1
        return base.getUserGroups(sub)
      },
    }
    assert.equal(await resolveGroupOverage(claims, directory), true)
    assert.equal(calls, 0)
    assert.deepEqual(claims.groups, [`${issuer}|eng`])
  })
})
