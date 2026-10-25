import assert from 'node:assert/strict'
import { after, it } from 'node:test'

process.env.POSTGRES_PORT = '1'
process.env.POSTGRES_PASSWORD = 'unused'
const { closeMainDatabase, postgresReadiness } = await import('./database.js')

after(() => closeMainDatabase())

it('readiness is red when PostgreSQL is unreachable', async () => {
  const ready = await postgresReadiness()
  assert.equal(ready.ok, false)
  assert.ok(ready.detail)
})
