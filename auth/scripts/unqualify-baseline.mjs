// drizzle-kit qualifies foreign keys with "public"; dropping it keeps the baseline
// schema-relative so tests can run it inside a private schema on the live server.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

for (const f of readdirSync('drizzle').filter((n) => n.endsWith('.sql'))) {
  const path = `drizzle/${f}`
  writeFileSync(path, readFileSync(path, 'utf8').replaceAll('"public".', ''))
}
