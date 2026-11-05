import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { describe, it } from 'node:test'
import { eq } from 'drizzle-orm'
import { immudbConfig, openLedger } from '../../auditLedger.js'
import { getDb } from '../../db/database.js'
import { signatureIndex, principals } from '../../db/schema.js'
import { openSignatureStore, type NewSignature } from './signatureStore.js'

const db = getDb()

const prefix = `esign-test/${randomBytes(4).toString('hex')}/`
const ledger = await openLedger({ ...immudbConfig(), prefix })
const store = openSignatureStore(ledger)

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const signer = { iss: 'https://idp.test', sub: `alice-${randomBytes(3).toString('hex')}`, name: 'Alice Anders' }
const evidence = {
  mfaEvidence: { acr: 'mfa', amr: ['pwd', 'otp'], auth_time: 1_767_225_600 },
  verificationMetadata: { jwks_key_id: 'kid-1', token_verified_at: 1_767_225_601_000, idp_issuer: 'https://idp.test' },
}
const manifest = 'a.csv 11aa\nb.csv 22bb\n'
const binding = {
  repo: `ns/repo-${randomBytes(3).toString('hex')}`,
  sourceHead: 'src111',
  targetHead: 'tgt222',
  manifestDigest: sha(manifest),
}
const base: NewSignature = { signer, meaning: 'Approved', contentHash: sha('content'), ...evidence }

describe('authoritative signature record', () => {
  it('stores the full record in the ledger with a server timestamp and no way to change it', async () => {
    const saved = await store.record({ ...base, binding, manifest })
    const back = await store.get(saved.id)
    assert.equal(back?.record.signer.name, 'Alice Anders')
    assert.equal(back?.record.signer.iss, signer.iss)
    assert.equal(back?.record.signer.sub, signer.sub)
    assert.equal(back?.record.meaning, 'Approved')
    assert.deepEqual(back?.record.verificationMetadata, evidence.verificationMetadata)
    assert.deepEqual(back?.record.binding, binding)
    assert.ok(!Number.isNaN(Date.parse(back!.record.signedAt)))
  })

  it('stores the manifest before the signature and refuses one that does not match the digest', async () => {
    await assert.rejects(store.record({ ...base, binding, manifest: 'tampered' }), /manifest/i)
    await assert.rejects(store.record({ ...base, binding }), /manifest/i)

    const saved = await store.record({ ...base, binding, manifest })
    const stored = await store.getManifest(binding.manifestDigest)
    assert.equal(stored?.manifest, manifest)
    assert.ok(stored!.seq < saved.seq)
  })

  it('retrieves a verification proof that fails when the stored value is altered', async () => {
    const saved = await store.record(base)
    const proof = await store.proof(saved.id)
    assert.equal(proof?.valid, true)
    assert.equal(proof?.seq, saved.seq)
    assert.match(proof!.transactionHash, /^[0-9a-f]{64}$/)

    const altered = await store.proof(saved.id, { tamper: (r) => ({ ...r, value: r.value.replace('Approved', 'Authored') }) })
    assert.equal(altered?.valid, false)
    assert.equal(await store.proof('missing'), undefined)
  })

  it('finds signatures through the Postgres index and rebuilds the index from the ledger', async () => {
    const own = { ...binding, repo: `ns/own-${randomBytes(3).toString('hex')}` }
    const other = { ...signer, sub: `bob-${randomBytes(3).toString('hex')}`, name: 'Bob' }
    const mine = await store.record({ ...base, binding: own, manifest })
    await store.record({ ...base, signer: other, binding: own, manifest })

    assert.equal((await store.find({ repo: own.repo })).length, 2)
    const byCommit = await store.find({ repo: own.repo, commit: 'src111', signer: { iss: signer.iss, sub: signer.sub } })
    assert.deepEqual(byCommit.map((s) => s.id), [mine.id])

    await db.delete(signatureIndex).where(eq(signatureIndex.repo, own.repo))
    assert.equal((await store.find({ repo: own.repo })).length, 0)
    await store.rebuildIndex()
    assert.equal((await store.find({ repo: own.repo })).length, 2)
  })

  it('shows the signed name snapshot and a "now known as" note, and survives deactivation', async () => {
    const who = { iss: 'https://idp.test', sub: `jane-${randomBytes(3).toString('hex')}`, name: 'Dr. Jane Smith' }
    const [row] = await db.insert(principals).values({ iss: who.iss, sub: who.sub, createdAt: new Date(), name: 'Dr. Jane Smith' }).returning()
    const saved = await store.record({ ...base, signer: who })

    assert.equal((await store.view(saved.id))?.nowKnownAs, undefined)

    await db.update(principals).set({ name: 'Dr. Jane Jones', flags: ['suspended'] }).where(eq(principals.id, row!.id))
    const view = await store.view(saved.id)
    assert.deepEqual(
      { name: view?.signer.name, iss: view?.signer.iss, sub: view?.signer.sub, nowKnownAs: view?.nowKnownAs },
      { name: 'Dr. Jane Smith', iss: who.iss, sub: who.sub, nowKnownAs: 'Dr. Jane Jones' },
    )
    assert.ok(view?.signedAt)
    assert.equal((await store.proof(saved.id))?.valid, true)
    assert.equal(await store.view('missing'), undefined)
  })
})
