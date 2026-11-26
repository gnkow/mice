import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { commitAuthor, injectAuthorJson, stampOxenAuthorBody } from '../../src/packages/authentication/lib/author.js'
import { humanCommitFields } from '../../src/packages/authentication/lib/commits/commitIdentity.js'

const user = {
  sub: 'alice',
  iss: 'https://idp.example/',
  email: 'alice@example.com',
  name: 'Alice',
}

const fields = humanCommitFields(user)

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

describe('stampOxenAuthorBody (Ticket 08)', () => {
  it('stamps author and email from HumanCommitFields without a SessionUser', () => {
    const next = stampOxenAuthorBody(
      { author: 'forged', email: 'forged@x.io', message: 'keep me' },
      fields,
    )
    assert.equal(next.author, fields.author)
    assert.equal(next.email, fields.email)
    assert.equal(next.message, 'keep me')
  })

  it('does not treat repo create name as an author', () => {
    const body = { namespace: 'lab', name: 'assays' }
    const next = stampOxenAuthorBody(body, fields)
    assert.equal(next.name, 'assays')
    assert.equal(next.namespace, 'lab')
  })

  it('overwrites nested author objects that carry email', () => {
    const next = stampOxenAuthorBody(
      {
        message: 'merge',
        committer: { name: 'forged', email: 'forged@x.io' },
      },
      fields,
    )
    assert.equal(next.author, fields.author)
    const committer = next.committer as { name: string; email: string }
    assert.equal(committer.name, fields.author)
    assert.equal(committer.email, fields.email)
  })
})
