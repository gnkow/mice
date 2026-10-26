import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createAuthTestApp } from './authTestApp.js'

await describe('authTestApp', async () => {
  await it('IdP issues a token for a configured user', async () => {
    const app = createAuthTestApp({
      users: [{ sub: 'alice', email: 'alice@example.com', name: 'Alice' }],
    })

    const token = await app.idp.issueToken('alice')
    
    assert.ok(token)
    assert.equal(typeof token, 'string')
  })
})
