import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { canonicalJson } from './auditChain.js'

export type AuditSigningKey = {
  keyId: string
  privateKey: KeyObject
  publicKeyPem: string
}

export type AuditSigningSource = {
  /** PEM (PKCS#8) Ed25519 private key; literal `\n` sequences are accepted for env use. */
  key?: string
  keyFile?: string
  keyId?: string
  dataDir: string
}

function pemOf(key: KeyObject): string {
  return key.export({ type: 'spki', format: 'pem' }).toString()
}

/** Builds a signing key from a PEM; the key id defaults to a fingerprint of the public key. */
export function signingKeyFromPem(privateKeyPem: string, keyId?: string): AuditSigningKey {
  const privateKey = createPrivateKey(privateKeyPem.includes('\\n') ? privateKeyPem.replace(/\\n/g, '\n') : privateKeyPem)
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('The audit signing key must be an Ed25519 key')
  const publicKeyPem = pemOf(createPublicKey(privateKey))
  const fingerprint = createHash('sha256')
    .update(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }))
    .digest('hex')
    .slice(0, 16)
  return { keyId: keyId?.trim() || `ed25519-${fingerprint}`, privateKey, publicKeyPem }
}

/**
 * Loads the checkpoint signing key from the environment or a secret mount. Throws when none is
 * configured, and when the key file lives inside the data directory (whoever can rewrite the
 * data volume could then forge checkpoints).
 */
export function loadSigningKey(src: AuditSigningSource): AuditSigningKey {
  let pem = src.key?.trim()
  if (!pem && src.keyFile) {
    const file = resolve(src.keyFile)
    const rel = relative(resolve(src.dataDir), file)
    if (!rel.startsWith('..') && !isAbsolute(rel)) {
      throw new Error(`AUDIT_SIGNING_KEY_FILE must be outside AUTH_DATA_DIR (${src.dataDir}); mount the key as a secret instead`)
    }
    pem = readFileSync(file, 'utf8').trim()
  }
  if (!pem) {
    throw new Error(
      'Audit checkpoints need a signing key: set AUDIT_SIGNING_KEY or AUDIT_SIGNING_KEY_FILE (Ed25519 PEM, outside AUTH_DATA_DIR) and AUDIT_SIGNING_KEY_ID',
    )
  }
  return signingKeyFromPem(pem, src.keyId)
}

/** Detached Ed25519 signature (base64) over the canonical JSON of a record. */
export function signRecord(key: AuditSigningKey, body: object): string {
  return sign(null, Buffer.from(canonicalJson(body)), key.privateKey).toString('base64')
}

export function verifyRecord(publicKeyPem: string, body: object, signature: string): boolean {
  try {
    return verify(null, Buffer.from(canonicalJson(body)), createPublicKey(publicKeyPem), Buffer.from(signature, 'base64'))
  } catch {
    return false
  }
}
