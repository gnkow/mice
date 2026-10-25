#!/usr/bin/env node
/**
 * Creates the dev passwords for PostgreSQL, immudb and Novu (MongoDB, Redis, JWT and API keys) as files under .secrets/ (gitignored).
 * Usage: node scripts/gen-db-secrets.mjs [dir]   (default .secrets)
 * Idempotent: existing files are never overwritten (that would lock you out of an initialised volume).
 * Production: create the same files in your secret manager and mount them; see plans/16-operations.md.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dir = resolve(process.argv[2] ?? '.secrets')
mkdirSync(dir, { recursive: true })

const password = () => randomBytes(18).toString('base64url')
const files = {
  'postgres-password': () => password(),
  'immudb-password': () => password(),
  // Novu enforces upper, lower, digit and symbol for the BFF's own account.
  'novu-password': () => `${password()}aA1!`,
}

for (const [name, make] of Object.entries(files)) {
  const target = join(dir, name)
  if (existsSync(target)) {
    console.log(`already present: ${target}`)
    continue
  }
  // World-readable on purpose for the dev bind mount (container users differ from the host user); never reuse outside dev.
  writeFileSync(target, make(), { mode: 0o644 })
  console.log(`created: ${target}`)
}

// immudb reads its admin password from IMMUDB_ADMIN_PASSWORD (no *_FILE variant), so compose loads it with env_file.
const config = join(dir, 'immudb.env')
if (!existsSync(config)) {
  const pass = readFileSync(join(dir, 'immudb-password'), 'utf8').trim()
  writeFileSync(config, `IMMUDB_ADMIN_PASSWORD=${pass}\n`, { mode: 0o644 })
  console.log(`created: ${config}`)
}

// Novu reads every secret from environment variables, so one env file feeds mongodb, redis, api, worker and ws.
const novu = join(dir, 'novu.env')
if (!existsSync(novu)) {
  const mongo = password()
  const redis = password()
  const lines = [
    'MONGO_INITDB_ROOT_USERNAME=novu',
    `MONGO_INITDB_ROOT_PASSWORD=${mongo}`,
    `MONGO_URL=mongodb://novu:${mongo}@novu-mongodb:27017/novu?authSource=admin`,
    `REDIS_PASSWORD=${redis}`,
    `JWT_SECRET=${randomBytes(32).toString('hex')}`,
    // Novu requires exactly 32 characters.
    `STORE_ENCRYPTION_KEY=${randomBytes(16).toString('hex')}`,
    `NOVU_SECRET_KEY=${randomBytes(32).toString('hex')}`,
  ]
  writeFileSync(novu, `${lines.join('\n')}\n`, { mode: 0o644 })
  console.log(`created: ${novu}`)
}
