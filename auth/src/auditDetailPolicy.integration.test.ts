import './db/testSchema.js'
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-detail-policy-'))
process.env.SESSION_SECRET = 'test-session-secret-for-detail-policy'

const { appendIntent, listAllAuditEvents, useAuditLedger } = await import('./audit.js')
const { AuditDetailPolicyError } = await import('./auditDetailPolicy.js')
const { openLedger, immudbConfig } = await import('./auditLedger.js')

const actor = {
  sub: 'sci',
  iss: 'https://idp.test',
  email: 'sci@test',
  name: 'Sci',
}

beforeEach(async () => {
  useAuditLedger(
    await openLedger({ ...immudbConfig(), prefix: `detail-policy/${randomUUID()}/`, lazy: true }),
  )
})

describe('audit detail policy on Intent append', () => {
  it('refuses Intent when reason contains a token pattern', async () => {
    await assert.rejects(
      () =>
        appendIntent({
          actor,
          via: 'session',
          method: 'POST',
          path: '/api/x',
          status: 0,
          action: 'merge',
          reason: 'oops mice_pat_AB12CD34EF56GH78',
        }),
      (err: unknown) => err instanceof AuditDetailPolicyError && err.code === 'audit_secret_detected',
    )
    assert.equal((await listAllAuditEvents()).length, 0)
  })

  it('stores Intent when detail is clean', async () => {
    const ev = await appendIntent({
      actor,
      via: 'session',
      method: 'POST',
      path: '/api/x',
      status: 0,
      action: 'merge',
      reason: 'Approved under CC-9',
      detail: { self_merge: false },
    })
    assert.equal(ev.phase, 'intent')
    assert.equal((await listAllAuditEvents()).length, 1)
  })
})
