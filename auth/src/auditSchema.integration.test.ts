import './db/testSchema.js'
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-audit-schema-'))
process.env.SESSION_SECRET = 'test-session-secret-for-audit-schema'

const { appendIntent, listAllAuditEvents, queryAudit, useAuditLedger } = await import('./audit.js')
const { CURRENT_AUDIT_SCHEMA_VERSION } = await import('./auditSchema.js')
const { openLedger, immudbConfig } = await import('./auditLedger.js')

const actor = {
  sub: 'sci',
  iss: 'https://idp.test',
  email: 'sci@test',
  name: 'Sci',
}

beforeEach(async () => {
  useAuditLedger(
    await openLedger({ ...immudbConfig(), prefix: `audit-schema/${randomUUID()}/`, lazy: true }),
  )
})

describe('audit schema_version write/read', () => {
  it('stamps schema_version on new Intents and returns them through query', async () => {
    await appendIntent({
      actor,
      via: 'session',
      method: 'POST',
      path: '/api/x',
      status: 0,
      action: 'merge',
    })
    const all = await listAllAuditEvents()
    assert.equal(all[0]?.schema_version, CURRENT_AUDIT_SCHEMA_VERSION)
    const { events } = await queryAudit({ action: 'merge', includeChain: true, limit: 10 })
    assert.equal(events[0]?.schema_version, CURRENT_AUDIT_SCHEMA_VERSION)
  })
})
