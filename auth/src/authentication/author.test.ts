import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { commitAuthor, injectAuthorJson } from './author.js'

const user = {
  sub: 'alice',
  iss: 'https://idp.example/',
  email: 'alice@example.com',
  name: 'Alice',
}

describe('author injection (Ticket 08)', () => {
  it('commitAuthor is canonical iss|sub', () => {
    assert.equal(commitAuthor(user), 'https://idp.example|alice')
  })

  it('overwrites client author and email; leaves message unchanged', () => {
    const message = 'add assay\n\nSubmitted-by: forged|person'
    const next = injectAuthorJson(
      { author: 'forged', email: 'forged@x.io', message },
      user,
    )
    assert.equal(next.author, 'https://idp.example|alice')
    assert.equal(next.email, 'alice@example.com')
    assert.equal(next.message, message)
  })
})
