import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canonicalMutationContent,
  evaluateMutationSignatureBinding,
  mutationBodyFromProxyPayload,
  mutationContentHash,
  prepareMutationDocument,
  stableJson,
} from './mutationSignature.js'

describe('canonical mutation content', () => {
  it('is stable under key reordering', () => {
    const a = prepareMutationDocument({
      method: 'patch',
      path: '/auth/namespaces/acme?x=1',
      reason: 'Routine settings correction for assay batch',
      category: 'privileged_settings',
      body: { b: 1, a: 2 },
    })
    const b = prepareMutationDocument({
      method: 'PATCH',
      path: '/auth/namespaces/acme',
      reason: 'Routine settings correction for assay batch',
      category: 'privileged_settings',
      body: { a: 2, b: 1 },
    })
    assert.equal(a.hash, b.hash)
    assert.equal(a.action, 'privileged_settings')
    assert.equal(a.document.path, '/auth/namespaces/acme')
  })

  it('changes when the body changes', () => {
    const base = {
      method: 'PATCH',
      path: '/auth/namespaces/acme',
      reason: 'Routine settings correction for assay batch',
      category: 'privileged_settings',
    }
    const h1 = mutationContentHash(canonicalMutationContent({ ...base, body: { membersCanCreateRepos: false } }))
    const h2 = mutationContentHash(canonicalMutationContent({ ...base, body: { membersCanCreateRepos: true } }))
    assert.notEqual(h1, h2)
  })

  it('sorts nested objects for hashing', () => {
    assert.equal(stableJson({ z: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"z":1}')
  })

  it('evaluateMutationSignatureBinding rejects meaning and hash mismatches', () => {
    const prepared = prepareMutationDocument({
      method: 'PATCH',
      path: '/auth/namespaces/acme',
      reason: 'Routine settings correction for assay batch',
      category: 'privileged_settings',
      body: { a: 1 },
    })
    const base = {
      signer: { iss: 'https://idp.test', sub: 'u1', name: 'U' },
      method: 'PATCH',
      path: '/auth/namespaces/acme',
      reason: 'Routine settings correction for assay batch',
      category: 'privileged_settings',
      body: { a: 1 },
      now: Date.now(),
    }
    assert.equal(
      evaluateMutationSignatureBinding({
        ...base,
        record: {
          id: 's1',
          meaning: 'Reviewed',
          contentHash: prepared.hash,
          signedAt: new Date().toISOString(),
          signer: base.signer,
        } as never,
      }).ok,
      false,
    )
    assert.equal(
      evaluateMutationSignatureBinding({
        ...base,
        record: {
          id: 's1',
          meaning: 'Approved',
          contentHash: prepared.hash,
          signedAt: new Date().toISOString(),
          signer: base.signer,
        } as never,
      }).ok,
      true,
    )
    assert.equal(
      evaluateMutationSignatureBinding({
        ...base,
        body: { a: 2 },
        record: {
          id: 's1',
          meaning: 'Approved',
          contentHash: prepared.hash,
          signedAt: new Date().toISOString(),
          signer: base.signer,
        } as never,
      }).ok,
      false,
    )
  })

  it('mutationBodyFromProxyPayload hashes opaque strings', () => {
    const parsed = mutationBodyFromProxyPayload('{"a":1}')
    assert.deepEqual(parsed, { a: 1 })
    const opaque = mutationBodyFromProxyPayload('not-json')
    assert.equal(typeof (opaque as { sha256: string }).sha256, 'string')
  })

  it('normalizes encoded paths so client and server hashes match', () => {
    const reason = 'Routine settings correction for assay batch'
    const category = 'privileged_settings'
    const body = { description: 'Assay study namespace' }
    const encoded = prepareMutationDocument({
      method: 'PATCH',
      path: '/auth/namespaces/acme%2Dlab',
      reason,
      category,
      body,
    })
    const plain = prepareMutationDocument({
      method: 'PATCH',
      path: '/auth/namespaces/acme-lab',
      reason,
      category,
      body,
    })
    assert.equal(encoded.hash, plain.hash)
  })
})
