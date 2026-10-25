// Online backup of the auth database: a consistent VACUUM INTO copy while the BFF keeps serving.
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const source = process.env.AUTH_DATABASE_PATH || join((process.env.AUTH_DATA_DIR ?? './data').replace(/\/$/, ''), 'mice.db')
const dest = process.argv[2] || join(dirname(source), 'backups', `mice-${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
mkdirSync(dirname(dest), { recursive: true, mode: 0o700 })
const db = new DatabaseSync(source)
db.exec('PRAGMA busy_timeout = 5000')
db.prepare('VACUUM INTO ?').run(dest)
db.close()
console.log(dest)
