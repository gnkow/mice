import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.AUTHZ_ENFORCE = 'true'
process.env.AUTHZ_DEV_GRANT_ALL = 'false'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.AUTHZ_GROUP_BOOTSTRAP = JSON.stringify({
  'ra-fresh@example.com': { instancePermissions: ['view_audit'] },
})
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'

const { authorizeRepoAction, preparePrincipal } = await import('./authz.js')
const { setRepoCollaborator } = await import('./authzCollaboratorStore.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { getDb } = await import('./db/database.js')
const { sql } = await import('drizzle-orm')

/** A digest of every row of every table in the test schema, so any write shows up as a different value. */
async function snapshot(): Promise<string> {
  const result = await getDb().execute(sql`select md5(string_agg(query_to_xml(format('select * from %I order by 1', tablename), false, true, '')::text, '' order by tablename)) as digest from pg_tables where schemaname = current_schema()`)
  return String((result.rows[0] as { digest: string }).digest)
}
const person = (sub: string) => ({
  sub,
  iss: 'test',
  email: `${sub}@example.com`,
  name: sub,
})
const admin = { sub: 'admin', iss: 'test', email: 'admin@mice.local', name: 'Admin' }
await preparePrincipal(admin)

const ns = 'ra-ns'
const reader = person('ra-reader')
const writer = person('ra-writer')
const outsider = person('ra-outsider')
await createNamespaceAuthz(admin, ns, 'none', true)
await setRepoCollaborator(ns, 'r', reader, 'read')
await setRepoCollaborator(ns, 'r', writer, 'write')
for (const u of [reader, writer, outsider]) await preparePrincipal(u)

describe('authorizeRepoAction', () => {
  const readActions = ['job.read', 'workspace.read'] as const
  const writeActions = ['job.submit', 'job.cancel', 'job.complete', 'workspace.write'] as const

  for (const action of readActions) {
    it(`${action}: Read allows, outsider denied`, async () => {
      assert.equal((await authorizeRepoAction(reader, ns, 'r', action)).allow, true)
      assert.equal((await authorizeRepoAction(outsider, ns, 'r', action)).allow, false)
    })
  }
  for (const action of writeActions) {
    it(`${action}: Write allows, Read denied`, async () => {
      assert.equal((await authorizeRepoAction(writer, ns, 'r', action)).allow, true)
      const denied = await authorizeRepoAction(reader, ns, 'r', action)
      assert.equal(denied.allow, false)
      assert.ok(denied.reason)
    })
  }

  it('keeps the denial reasons callers surface', async () => {
    assert.equal(
      (await authorizeRepoAction(reader, ns, 'r', 'job.submit')).reason,
      'job.submit requires repository write or job_submit',
    )
    assert.equal(
      (await authorizeRepoAction(outsider, ns, 'r', 'workspace.write')).reason,
      'Requires repository write',
    )
  })

  it('is read-only: a decision does not write state', async () => {
    const before = await snapshot()
    await authorizeRepoAction({ ...person('ra-fresh'), emailVerified: true }, ns, 'r', 'job.read')
    assert.equal(await snapshot(), before)
  })
})
