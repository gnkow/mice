import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  decideUserRefLabel,
  decideUserRefUsername,
  parsePrincipalAuthor,
} from './userRef.ts'

describe('parsePrincipalAuthor', () => {
  it('splits iss|sub', () => {
    assert.deepEqual(
      parsePrincipalAuthor('http://localhost:8180/realms/mice|dfca962d-7983-44d1-aa21-b2e82d90fba3'),
      {
        iss: 'http://localhost:8180/realms/mice',
        sub: 'dfca962d-7983-44d1-aa21-b2e82d90fba3',
      },
    )
  })

  it('rejects non-principal authors', () => {
    assert.equal(parsePrincipalAuthor('Alice'), null)
    assert.equal(parsePrincipalAuthor('|only-sub'), null)
    assert.equal(parsePrincipalAuthor('only-iss|'), null)
  })

  it('splits AuthZ storage keys that use the unit separator', () => {
    assert.deepEqual(
      parsePrincipalAuthor(
        'http://localhost:8180/realms/mice\u001fa0000000-0000-4000-8000-000000000002',
      ),
      {
        iss: 'http://localhost:8180/realms/mice',
        sub: 'a0000000-0000-4000-8000-000000000002',
      },
    )
  })
})

describe('decideUserRefLabel', () => {
  const author =
    'http://localhost:8180/realms/mice|dfca962d-7983-44d1-aa21-b2e82d90fba3'

  it('prefers display name', () => {
    assert.equal(
      decideUserRefLabel({ author, name: 'Regular User', email: 'mice_user@mice.com' }),
      'Regular User',
    )
  })

  it('falls back to email local-part', () => {
    assert.equal(
      decideUserRefLabel({ author, email: 'mice_user@mice.com' }),
      'mice_user',
    )
  })

  it('falls back to a short sub', () => {
    assert.equal(decideUserRefLabel({ author }), 'dfca962d…')
  })
})

describe('decideUserRefUsername', () => {
  it('uses the email local-part', () => {
    assert.equal(
      decideUserRefUsername({
        author: 'http://idp|sub',
        email: 'alice@example.com',
      }),
      'alice',
    )
  })
})
