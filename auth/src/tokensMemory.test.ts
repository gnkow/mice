import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { after, describe, it } from 'node:test'
import { createMemoryJsonBackend, useJsonBackend } from './jsonStore.js'

const memory = createMemoryJsonBackend()
const restoreBackend = useJsonBackend(memory)
process.env.AUTH_DATA_DIR = '/mice-memory-data'
process.env.SESSION_SECRET = 'test-session-secret-for-tokens'

const { createPat, resolvePat, revokePat } = await import('./tokens.js')

after(() => restoreBackend())

const alice = { sub: 'alice', iss: 'test', email: 'alice@example.com', name: 'Alice' }

describe('PAT store through the persistence seam', () => {
  it('mints, resolves and revokes without touching disk', () => {
    const { token, pat } = createPat(alice, 'laptop')
    assert.equal(resolvePat(token)?.sub, 'alice')
    assert.equal(memory.read('/mice-memory-data/pats.json') !== undefined, true)
    assert.equal(existsSync('/mice-memory-data'), false)
    assert.equal(revokePat(alice, pat.id), true)
    assert.equal(resolvePat(token), null)
  })
})
