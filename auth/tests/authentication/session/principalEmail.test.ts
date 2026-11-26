import '../../../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensurePrincipal, getCurrentEmail, currentEmailsByAuthor } from '../../../src/packages/authentication/lib/session/session.js'

describe('Principal current email', () => {
  it('keeps one current email and replaces it when a later login differs', async () => {
    const first = await ensurePrincipal({
      iss: 'https://idp.example/',
      sub: 'email-alice',
      email: 'alice@lab.test',
    })
    assert.equal(await getCurrentEmail({ iss: 'https://idp.example', sub: 'email-alice' }), 'alice@lab.test')

    const second = await ensurePrincipal({
      iss: 'https://idp.example',
      sub: 'email-alice',
      email: 'alice@lab.test',
    })
    assert.equal(second, first)
    assert.equal(await getCurrentEmail({ iss: 'https://idp.example/', sub: 'email-alice' }), 'alice@lab.test')

    await ensurePrincipal({
      iss: 'https://idp.example',
      sub: 'email-alice',
      email: 'jane@lab.test',
    })
    assert.equal(await getCurrentEmail({ iss: 'https://idp.example', sub: 'email-alice' }), 'jane@lab.test')
  })

  it('resolves a commit author to the current email and skips an unknown author', async () => {
    await ensurePrincipal({
      iss: 'https://idp.example/',
      sub: 'view-alice',
      email: 'alice@lab.test',
    })
    const emails = await currentEmailsByAuthor([
      'https://idp.example|view-alice',
      'https://idp.example|missing-person',
    ])
    assert.deepEqual(emails, { 'https://idp.example|view-alice': 'alice@lab.test' })
  })

  it('resolves AuthZ unit-separator keys (MR openedBy) to the canonical iss|sub map', async () => {
    await ensurePrincipal({
      iss: 'https://idp.example/',
      sub: 'mr-opener',
      email: 'opener@lab.test',
      name: 'MR Opener',
    })
    const { currentProfilesByAuthor } = await import('../../../src/packages/authentication/lib/session/session.js')
    const profiles = await currentProfilesByAuthor([
      'https://idp.example\u001fmr-opener',
    ])
    assert.deepEqual(profiles.emails, {
      'https://idp.example|mr-opener': 'opener@lab.test',
    })
    assert.deepEqual(profiles.names, {
      'https://idp.example|mr-opener': 'MR Opener',
    })
  })
})
