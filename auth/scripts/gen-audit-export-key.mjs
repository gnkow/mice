#!/usr/bin/env node
/**
 * Generate an Ed25519 key pair for audit export signing.
 * Put the private key in AUDIT_EXPORT_PRIVATE_KEY; file the public key in the IQP.
 */
import { generateKeyPairSync } from 'node:crypto'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
process.stdout.write(`# AUDIT_EXPORT_PRIVATE_KEY (keep secret; set on the auth service)\n`)
process.stdout.write(privatePem)
process.stdout.write(`\n# Public key — record in the IQP alongside the immudb genesis root\n`)
process.stdout.write(publicPem)
