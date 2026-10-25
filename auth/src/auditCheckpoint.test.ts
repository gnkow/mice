import assert from 'node:assert/strict'
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth()
const { appendAudit, initAudit, verifyAudit, writeCheckpoint, startAuditCheckpointSchedule, useAuditSigningKey, initAuditSigning, auditCheckpoints } =
  await import('./audit.js')
const { canonicalJson } = await import('./auditChain.js')
const { fakeClock } = await import('./clock.js')
const { appendText, createMemoryJsonBackend, readText, useJsonBackend, writeText } = await import('./jsonStore.js')

const AUDIT = '/mice-memory-data/audit.jsonl'
const CHECKPOINTS = '/mice-memory-data/audit-checkpoints.jsonl'
const actor = { sub: 's1', email: 'a@x.io', name: 'Ann', iss: 'iss' }
const add = (action: string) => appendAudit({ actor, via: 'session', method: 'POST', path: '/x', status: 200, action })
const auditLines = () => (readText(AUDIT) ?? '').split('\n').filter(Boolean)

function newKey(keyId: string) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    keyId,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

let restore: () => void
beforeEach(() => {
  restore = useJsonBackend(createMemoryJsonBackend())
  initAudit()
})
afterEach(() => restore())

describe('signed checkpoints', () => {
  it('signs last hash, event count and key id so a third party can verify with the public key alone', () => {
    const key = newKey('k-2026')
    useAuditSigningKey(key)
    add('file.write')
    add('file.delete')
    const cp = writeCheckpoint('daily')!
    assert.equal(cp.key_id, 'k-2026')
    assert.equal(cp.event_count, 3)
    assert.equal(cp.last_hash, JSON.parse(auditLines()[2]!).hash)
    const { signature, ...body } = cp
    assert.ok(
      verify(null, Buffer.from(canonicalJson(body)), createPublicKey(key.publicKeyPem), Buffer.from(signature, 'base64')),
    )
    assert.equal(verifyAudit().ok, true)
  })

  it('detects dropped trailing events that the chain alone cannot see', () => {
    useAuditSigningKey(newKey('k1'))
    add('file.write')
    add('file.delete')
    writeCheckpoint('daily')
    assert.equal(verifyAudit().ok, true)
    writeText(AUDIT, `${auditLines().slice(0, 2).join('\n')}\n`)
    const v = verifyAudit()
    assert.equal(v.ok, false)
    assert.match(!v.ok ? v.firstBreak.reason : '', /checkpoint/i)
  })

  it('detects an altered checkpoint and a deleted checkpoint file', () => {
    useAuditSigningKey(newKey('k1'))
    add('file.write')
    writeCheckpoint('daily')
    const forged = (readText(CHECKPOINTS) ?? '').replace(/"event_count":\d+/, '"event_count":1')
    writeText(CHECKPOINTS, forged)
    assert.equal(verifyAudit().ok, false)
    writeText(CHECKPOINTS, '')
    const v = verifyAudit()
    assert.equal(v.ok, false)
    assert.match(!v.ok ? v.firstBreak.reason : '', /checkpoint/i)
  })

  it('keeps old public keys so checkpoints stay verifiable after rotation', () => {
    useAuditSigningKey(newKey('k-old'))
    add('file.write')
    writeCheckpoint('daily')
    useAuditSigningKey(newKey('k-new'))
    add('file.delete')
    writeCheckpoint('daily')
    assert.deepEqual(auditCheckpoints().map((c) => c.key_id), ['k-old', 'k-new'])
    assert.equal(verifyAudit().ok, true)
  })

  it('refuses to reuse a key id for a different key', () => {
    useAuditSigningKey(newKey('k1'))
    assert.throws(() => useAuditSigningKey(newKey('k1')), /key id/i)
  })

  it('writes daily on the clock and on shutdown, skipping when nothing happened', () => {
    useAuditSigningKey(newKey('k1'))
    const clock = fakeClock()
    const schedule = startAuditCheckpointSchedule({ clock, poll: false })
    add('file.write')
    assert.equal(schedule.tick(), false)
    assert.equal(auditCheckpoints().length, 0)
    clock.advance(24 * 3600_000 + 1)
    assert.equal(schedule.tick(), true)
    assert.equal(auditCheckpoints().length, 1)
    clock.advance(24 * 3600_000 + 1)
    assert.equal(schedule.tick(), true)
    assert.equal(auditCheckpoints().length, 1, 'no new events, no new checkpoint')
    add('file.delete')
    assert.equal(writeCheckpoint('shutdown')?.trigger, 'shutdown')
    assert.equal(auditCheckpoints().length, 2)
    assert.equal(verifyAudit().ok, true)
  })

  it('does not sign a chain that fails verification', () => {
    useAuditSigningKey(newKey('k1'))
    add('file.write')
    appendText(AUDIT, '{"garbage":true}\n')
    assert.throws(() => writeCheckpoint('daily'), /verification/i)
  })
})

describe('signing key at boot', () => {
  it('fails when no key is configured', () => {
    assert.throws(() => initAuditSigning({ dataDir: '/data' }), /AUDIT_SIGNING_KEY/)
  })

  it('reads the key from a secret-mount file and derives a key id', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(process.cwd(), '.tmp-keytest-'))
    try {
      const key = newKey('x')
      writeFileSync(join(dir, 'k.pem'), key.privateKeyPem)
      const info = initAuditSigning({ keyFile: join(dir, 'k.pem'), dataDir: '/mice-memory-data' })
      assert.match(info.keyId, /^ed25519-[0-9a-f]{16}$/)
      assert.equal(info.publicKeyPem.trim(), key.publicKeyPem.trim())
      assert.equal(initAuditSigning({ keyFile: join(dir, 'k.pem'), keyId: 'prod-1', dataDir: '/mice-memory-data' }).keyId, 'prod-1')
      assert.throws(() => initAuditSigning({ keyFile: join(dir, 'k.pem'), dataDir: dir }), /outside/i)
    } finally {
      const { rmSync } = await import('node:fs')
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('accepts the key inline and rejects a non-Ed25519 key', () => {
    const key = newKey('x')
    assert.equal(initAuditSigning({ key: key.privateKeyPem.replace(/\n/g, '\\n'), dataDir: '/d' }).keyId.startsWith('ed25519-'), true)
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    assert.throws(() => initAuditSigning({ key: rsa, dataDir: '/d' }), /Ed25519/)
  })
})
