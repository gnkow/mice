import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensurePrincipal, getCurrentEmail, currentEmailsByAuthor } from './session.js'

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
})
