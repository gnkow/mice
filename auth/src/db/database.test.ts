import './testSchema.js'
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { sql } from 'drizzle-orm'
import { assertSchemaVersion, expectedMigrationCount, inTransaction, postgresReadiness, schemaVersion } from './database.js'
import { postgresConfig } from './connection.js'
import { connectTestDatabase } from './testDatabase.js'

let t: Awaited<ReturnType<typeof connectTestDatabase>>

before(async () => {
  t = await connectTestDatabase()
  await t.db.execute(sql`create table if not exists tx_probe (id text primary key)`)
})
const exists = async (id: string) =>
  (await t.db.execute(sql`select 1 from tx_probe where id = ${id}`)).rows.length === 1

describe('main database', () => {
  it('applies the baseline migration and reports it ready', async () => {
    assert.equal(await schemaVersion(), expectedMigrationCount())
    const ready = await postgresReadiness()
    assert.equal(ready.ok, true)
  })

  it('transaction scope commits on success', async () => {
    const id = t.id('commit')
    t.onCleanup(() => t.db.execute(sql`delete from tx_probe where id = ${id}`))
    const out = await inTransaction(async (tx) => {
      await tx.execute(sql`insert into tx_probe values (${id})`)
      return 'done'
    })
    assert.equal(out, 'done')
    assert.equal(await exists(id), true)
  })

  it('transaction scope rolls back when the work throws', async () => {
    const id = t.id('rollback')
    t.onCleanup(() => t.db.execute(sql`delete from tx_probe where id = ${id}`))
    await assert.rejects(
      inTransaction(async (tx) => {
        await tx.execute(sql`insert into tx_probe values (${id})`)
        throw new Error('boom')
      }),
      /boom/,
    )
    assert.equal(await exists(id), false)
  })

  it('parallel runs get distinct ids and do not see each other', async () => {
    const other = await connectTestDatabase()
    assert.notEqual(other.runId, t.runId)
    assert.notEqual(other.id(), t.id())
  })

  it('refuses a schema version that is not this release', () => {
    assert.throws(() => assertSchemaVersion(2, 1), /does not match this release/)
    assert.throws(() => assertSchemaVersion(0, 1), /does not match this release/)
    assert.doesNotThrow(() => assertSchemaVersion(1, 1))
  })

  it('an explicit password wins over secret files', () => {
    assert.equal(postgresConfig({ POSTGRES_PASSWORD: 'pw', POSTGRES_HOST: 'db' } as NodeJS.ProcessEnv).password, 'pw')
  })
})
