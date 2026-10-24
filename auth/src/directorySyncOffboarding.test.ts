import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { useJsonBackend, type JsonBackend } from './jsonStore.js'
import { isolatedAuth } from './testSupport.js'

const ctx = isolatedAuth({ OIDC_ISSUER_PUBLIC: 'idp' })
after(() => ctx.restore())

const { runDirectorySync } = await import('./directorySync.js')
const { createPat } = await import('./tokens.js')
const { isCredentialRevoked } = await import('./credentialRevocation.js')
const { queryAudit } = await import('./audit.js')

const failingWrites = (pattern: string): (() => void) => {
  const inner: JsonBackend = ctx.backend
  return useJsonBackend({
    read: (p) => inner.read(p),
    write: (p, t, o) => {
      if (p.includes(pattern)) throw new Error(`disk full: ${pattern}`)
      inner.write(p, t, o)
    },
    append: (p, t) => inner.append!(p, t),
  })
}

const gone = { sub: 'leaver', iss: 'idp', email: 'leaver@x.io', name: 'leaver' }
const lookup = async () => 'missing' as const

describe('directory sync acts on the offboarding result', () => {
  it('reports an incomplete offboarding, audits it, and retries it on the next run', async () => {
    createPat(gone, 'cli')
    const restore = failingWrites('session-revocations')
    let first
    try {
      first = await runDirectorySync({ lookup })
    } finally {
      restore()
    }
    assert.ok(first.ok)
    assert.deepEqual(first.revoked, [])
    assert.equal(first.incomplete.length, 1)
    assert.equal(first.incomplete[0]!.sub, 'leaver')
    assert.deepEqual(first.incomplete[0]!.failed.map((f) => f.step), ['revoke-credentials', 'audit-revocation'])
    const ev = queryAudit({ action: 'directory.sync.failed' }).events[0]!
    assert.equal(ev.status, 500)
    assert.match(ev.message ?? '', /leaver/)

    const retry = await runDirectorySync({ lookup })
    assert.ok(retry.ok)
    assert.deepEqual(retry.revoked, [{ sub: 'leaver', iss: 'idp' }])
    assert.deepEqual(retry.incomplete, [])
    assert.equal(isCredentialRevoked(gone, 0, 'session'), true)
  })
})
