import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { postgresConfig } from './connection.js'
import { useTestSchema } from './testDatabase.js'

/**
 * Import first in a test file: gives the file a private schema on the live PostgreSQL and drops it
 * when the process exits. A test runner `after` hook fires after the first top-level suite, so the
 * drop runs in a synchronous child process at exit instead.
 */
// The audit ledger is append-only, so tests share one database and each file writes under a private key prefix.
process.env.IMMUDB_DATABASE ??= 'audit_test'
/** Private immudb key space for this test file (call again before openLedger when isolation=none). */
export function isolateAuditKeyPrefix(): string {
  const prefix = `audit/${randomUUID()}/`
  process.env.IMMUDB_KEY_PREFIX = prefix
  return prefix
}
isolateAuditKeyPrefix()
await useTestSchema()
const schema = process.env.MICE_TEST_SCHEMA!
const config = { ...postgresConfig(), options: undefined }

process.on('exit', () => {
  spawnSync(
    process.execPath,
    [
      '-e',
      `const pg=require('pg');(async()=>{const c=new pg.Client(JSON.parse(process.env.PGCFG));await c.connect();await c.query('drop schema if exists "'+process.env.DROP_SCHEMA+'" cascade');await c.end()})().catch(()=>process.exit(1))`,
    ],
    {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      env: { ...process.env, PGCFG: JSON.stringify(config), DROP_SCHEMA: schema },
      stdio: 'ignore',
    },
  )
})
