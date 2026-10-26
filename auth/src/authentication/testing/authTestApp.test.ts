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

  await it('clock offset can be applied to the BFF and IdP', async () => {
    const app = createAuthTestApp({
      users: [{ sub: 'bob', email: 'bob@example.com', name: 'Bob' }],
    })

    const initialTime = app.clock.now()
    
    // Advance clock by 1 hour
    app.clock.advance(60 * 60 * 1000)
    
    const laterTime = app.clock.now()
    assert.equal(laterTime - initialTime, 60 * 60 * 1000)
  })
})
