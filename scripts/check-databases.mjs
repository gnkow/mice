#!/usr/bin/env node
// Fails fast with a clear message when the dev databases the tests share are not reachable.
import net from 'node:net'

const targets = [
  ['PostgreSQL', process.env.POSTGRES_HOST ?? '127.0.0.1', Number(process.env.POSTGRES_PORT ?? 5432)],
  ['immudb', process.env.IMMUDB_HOST ?? '127.0.0.1', Number(process.env.IMMUDB_PORT ?? 3322)],
]

const down = []
await Promise.all(
  targets.map(
    ([name, host, port]) =>
      new Promise((done) => {
        const s = net.connect({ host, port, timeout: 2000 })
        s.once('connect', () => { s.destroy(); done() })
        const fail = () => { s.destroy(); down.push(`${name} at ${host}:${port}`); done() }
        s.once('error', fail)
        s.once('timeout', fail)
      }),
  ),
)

if (down.length) {
  console.error(`Tests need the dev databases, but these are unreachable: ${down.join(', ')}.`)
  console.error('Start them with `make up` (or `docker compose up -d postgres immudb`).')
  process.exit(1)
}
