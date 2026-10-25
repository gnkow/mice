#!/usr/bin/env node
/**
 * Creates the Ed25519 key that signs audit checkpoints and export bundles (dev stack).
 * Usage: node scripts/gen-audit-key.mjs [path]   (default .secrets/audit-signing.pem)
 * Idempotent: an existing key is never overwritten (that would orphan its checkpoints).
 * Production: generate the key in your secret manager and mount it; see plans/16-operations.md.
 */
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const target = resolve(process.argv[2] ?? '.secrets/audit-signing.pem')
if (existsSync(target)) {
  console.log(`audit signing key already present: ${target}`)
} else {
  mkdirSync(dirname(target), { recursive: true })
  const { privateKey } = generateKeyPairSync('ed25519')
  // World-readable on purpose for the dev bind mount (the container user differs from the host user); never reuse this file outside dev.
  writeFileSync(target, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o644 })
  console.log(`created audit signing key: ${target}`)
}
