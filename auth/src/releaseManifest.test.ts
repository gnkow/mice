import './db/testSchema.js'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, before } from 'node:test'
import { immudbConfig, openLedger } from './auditLedger.js'
import { initAudit, queryAudit, useAuditLedger } from './audit.js'
import {
  buildReleaseManifestBody,
  compareReleaseComponents,
  liveReleaseComponents,
  loadSignedReleaseManifest,
  recordReleaseManifestCheck,
  releaseManifestStatus,
  resetReleaseManifestStatus,
  signReleaseManifest,
  verifyReleaseManifestAt,
  verifyReleaseManifestSignature,
  type ReleaseManifestBody,
} from './releaseManifest.js'

function signWith(privatePem: string, body: ReleaseManifestBody): string {
  return signReleaseManifest(body, privatePem)
}

describe('signed release manifest', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

  before(async () => {
    useAuditLedger(await openLedger(immudbConfig()))
    await initAudit()
  })

  it('live components expose digests for IdP configuration, search index, and custom verifiers', () => {
    const live = liveReleaseComponents()
    for (const id of ['idp_configuration', 'search_index', 'custom_verifiers'] as const) {
      assert.equal(typeof live[id].version, 'string')
      assert.match(live[id].digest, /^sha256:[0-9a-f]{64}$/)
    }
  })

  it('compare reports a match when digests agree', () => {
    const live = liveReleaseComponents()
    const result = compareReleaseComponents(live, live)
    assert.equal(result.match, true)
    assert.deepEqual(result.mismatches, [])
  })

  it('compare reports mismatches when a digest differs', () => {
    const live = liveReleaseComponents()
    const expected = {
      ...live,
      search_index: { version: live.search_index.version, digest: 'sha256:' + 'ab'.repeat(32) },
    }
    const result = compareReleaseComponents(expected, live)
    assert.equal(result.match, false)
    assert.ok(result.mismatches.some((m) => m.includes('search_index')))
  })

  it('rejects a manifest with an invalid signature', () => {
    const live = liveReleaseComponents()
    const body: ReleaseManifestBody = {
      format: 'mice-release-manifest/1',
      releaseVersion: '0.0.0',
      components: live,
    }
    const signed = { ...body, signature: signWith(privatePem, body) }
    const dir = mkdtempSync(join(tmpdir(), 'mice-release-bad-sig-'))
    const path = join(dir, 'release-manifest.json')
    writeFileSync(path, JSON.stringify({ ...signed, signature: 'not-a-real-signature' }))
    const result = loadSignedReleaseManifest(path, publicPem)
    assert.equal(result.ok, false)
    if (!result.ok) assert.match(result.reason, /signature/i)
  })

  it('accepts a correctly signed manifest and verifies components', () => {
    const live = liveReleaseComponents()
    const body: ReleaseManifestBody = {
      format: 'mice-release-manifest/1',
      releaseVersion: '0.0.0',
      components: live,
    }
    const signed = { ...body, signature: signWith(privatePem, body) }
    const dir = mkdtempSync(join(tmpdir(), 'mice-release-ok-'))
    const path = join(dir, 'release-manifest.json')
    writeFileSync(path, JSON.stringify(signed))
    const loaded = loadSignedReleaseManifest(path, publicPem)
    assert.equal(loaded.ok, true)
    if (!loaded.ok) return
    const compared = compareReleaseComponents(loaded.manifest.components, live)
    assert.equal(compared.match, true)
  })

  it('verifyReleaseManifestAt records match status for the admin overview', async () => {
    resetReleaseManifestStatus()
    const live = liveReleaseComponents()
    const body: ReleaseManifestBody = {
      format: 'mice-release-manifest/1',
      releaseVersion: '0.0.0',
      components: live,
    }
    const dir = mkdtempSync(join(tmpdir(), 'mice-release-verify-'))
    const path = join(dir, 'release-manifest.json')
    writeFileSync(path, JSON.stringify({ ...body, signature: signWith(privatePem, body) }))
    const status = await verifyReleaseManifestAt({ path, publicKeyPem: publicPem })
    assert.equal(status.present, true)
    assert.equal(status.signatureValid, true)
    assert.equal(status.match, true)
    assert.equal(releaseManifestStatus()?.match, true)
  })

  it('mismatch is audited and retained for the admin overview', async () => {
    resetReleaseManifestStatus()
    const live = liveReleaseComponents()
    const body: ReleaseManifestBody = {
      format: 'mice-release-manifest/1',
      releaseVersion: '9.9.9',
      components: {
        ...live,
        custom_verifiers: { version: '1', digest: 'sha256:' + 'cd'.repeat(32) },
      },
    }
    const dir = mkdtempSync(join(tmpdir(), 'mice-release-mismatch-'))
    const path = join(dir, 'release-manifest.json')
    writeFileSync(path, JSON.stringify({ ...body, signature: signWith(privatePem, body) }))
    const status = await verifyReleaseManifestAt({ path, publicKeyPem: publicPem })
    assert.equal(status.match, false)
    assert.ok(status.mismatches.length > 0)
    await recordReleaseManifestCheck(status)
    const { events } = await queryAudit({ action: 'system.release_manifest.check', limit: 10 })
    assert.ok(
      events.some(
        (e) =>
          e.action === 'system.release_manifest.check' &&
          e.detail?.match === false &&
          Array.isArray(e.detail?.mismatches),
      ),
    )
    assert.equal(releaseManifestStatus()?.match, false)
  })

  it('buildReleaseManifestBody pins live digests for signing', () => {
    const body = buildReleaseManifestBody('1.2.3')
    assert.equal(body.releaseVersion, '1.2.3')
    assert.deepEqual(body.components, liveReleaseComponents())
  })

  it('sign and verifyReleaseManifestSignature round-trip on the shared seam', () => {
    const body = buildReleaseManifestBody('0.0.0')
    const sig = signReleaseManifest(body, privatePem)
    assert.equal(verifyReleaseManifestSignature(body, sig, publicPem), true)
    assert.equal(verifyReleaseManifestSignature(body, 'not-valid', publicPem), false)
  })
})
