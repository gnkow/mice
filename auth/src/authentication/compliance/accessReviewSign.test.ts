import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createHash } from 'node:crypto'
import {
  displayedAccessReview,
  generateAccessReviewReport,
  type AccessReviewReport,
} from './accessReview.js'
import { applyAccessReviewSign } from './accessReviewSign.js'
import type { SignatureRecord } from '../signing/signingCeremony.js'

function hashOf(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

function signatureFor(content: string): SignatureRecord {
  return {
    hash: hashOf(content),
    principal: { iss: 'https://idp.example.com', sub: 'reviewer', name: 'Reviewer' },
    signedAt: 1_700_000_000_000,
    meaning: 'Reviewed',
    content,
  }
}

describe('applyAccessReviewSign (#40)', () => {
  const report: AccessReviewReport = generateAccessReviewReport([], '2026-Q4', () => 1_700_000_000_000)

  it('seals the report when the expected hash matches the displayed document', () => {
    const content = displayedAccessReview(report)
    const expectedHash = hashOf(content)
    const result = applyAccessReviewSign(report, expectedHash, (doc) => signatureFor(doc))
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.contentHash, expectedHash)
    assert.ok(result.report.reviewerSignature)
    assert.equal(result.report.reviewerSignature.meaning, 'Reviewed')
    assert.equal(result.report.reviewerSignature.principal.sub, 'reviewer')
  })

  it('refuses when the stored report no longer matches the expected hash', () => {
    const result = applyAccessReviewSign(report, 'stale-hash', (doc) => signatureFor(doc))
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.error, /Content changed after display/)
    assert.equal(report.reviewerSignature, undefined)
  })
})
