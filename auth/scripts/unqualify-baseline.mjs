// drizzle-kit qualifies foreign keys with "public"; dropping it keeps the baseline
// schema-relative so tests can run it inside a private schema on the live server.
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

for (const f of readdirSync('drizzle').filter((n) => n.endsWith('.sql'))) {
  const path = `drizzle/${f}`
  writeFileSync(path, readFileSync(path, 'utf8').replaceAll('"public".', ''))
}

// Hand-written objects drizzle-kit cannot express (append-only triggers) join the single baseline.
appendFileSync(
  'drizzle/0000_baseline.sql',
  '\n--> statement-breakpoint\n' + readFileSync('scripts/append-only-triggers.sql', 'utf8'),
)
