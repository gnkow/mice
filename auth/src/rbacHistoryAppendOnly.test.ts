import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sql } from 'drizzle-orm'
import { ensurePrincipal } from './authentication/session/session.js'
import { getDb } from './db/database.js'
import { assignRole, grantCustomPermissions } from './rbacStore.js'

const person = (sub: string) => ({ sub, iss: 'https://idp.test', email: `${sub}@example.com`, name: sub })
const target = person('append-only-target')
await ensurePrincipal(target)
await assignRole({ actor: null, target, role: 'user', reason: 'boot', bootstrap: true })
await grantCustomPermissions({
  actor: null,
  target,
  permissions: ['repo:files:read'],
  reason: 'boot',
  bootstrap: true,
})

const tables = ['principal_role_history', 'principal_permission_history', 'permission_snapshots']
const rejected = async (statement: string) => {
  await assert.rejects(
    () => getDb().execute(sql.raw(statement)),
    (e: unknown) => /append-only/i.test(String((e as { cause?: unknown }).cause ?? e)),
    statement,
  )
}

describe('RBAC history is append-only in the database (#16)', () => {
  for (const table of tables) {
    it(`${table} rejects UPDATE and DELETE`, async () => {
      assert.ok(
        ((await getDb().execute(sql.raw(`select 1 from ${table} limit 1`))).rows as unknown[]).length > 0,
        `${table} has rows to tamper with`,
      )
      await rejected(`update ${table} set principal_id = principal_id`)
      await rejected(`delete from ${table}`)
    })
  }
})
