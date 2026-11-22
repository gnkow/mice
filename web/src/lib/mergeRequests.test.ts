import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isSelfSignBlocked,
  mergeRefusalMessage,
  mergeRequestTitle,
  normalizePrincipalAuthorKey,
} from './mergeRequests'

describe('mergeRefusalMessage (#73 self-merge)', () => {
  it('names the 4-eyes principle for self_merge refusals', () => {
    assert.match(mergeRefusalMessage('self_merge', 'fallback'), /4-eyes/i)
    assert.match(mergeRefusalMessage('self_merge', 'fallback'), /opened the request/i)
    assert.match(mergeRefusalMessage('self_merge', 'fallback'), /authored commits/i)
  })

  it('falls back when the code is unknown', () => {
    assert.equal(mergeRefusalMessage('nope', 'fallback text'), 'fallback text')
  })
})

describe('isSelfSignBlocked (#73 self-sign UI)', () => {
  const me = { iss: 'mice-dev', sub: 'mice' }

  it('blocks when the signer opened the request', () => {
    assert.equal(
      isSelfSignBlocked({ signer: me, openedBy: 'mice-dev|mice' }),
      true,
    )
    assert.equal(
      isSelfSignBlocked({ signer: me, openedBy: 'mice-dev\u001fmice' }),
      true,
    )
  })

  it('blocks when the signer authored a commit in range', () => {
    assert.equal(
      isSelfSignBlocked({
        signer: me,
        openedBy: 'other|user',
        commitAuthors: ['partner|x', 'mice-dev|mice'],
      }),
      true,
    )
  })

  it('allows a different approver', () => {
    assert.equal(
      isSelfSignBlocked({
        signer: me,
        openedBy: 'other|user',
        commitAuthors: ['other|user'],
      }),
      false,
    )
  })

  it('normalizes unit-separator AuthZ keys', () => {
    assert.equal(
      normalizePrincipalAuthorKey('mice-dev\u001fmice'),
      'mice-dev|mice',
    )
  })
})

describe('mergeRequestTitle', () => {
  it('uses the stored title when present', () => {
    assert.equal(
      mergeRequestTitle({
        title: 'Ship assay fix',
        sourceBranch: 'mice1',
        targetBranch: 'main',
      }),
      'Ship assay fix',
    )
  })

  it('falls back to the branch range when title is empty', () => {
    assert.equal(
      mergeRequestTitle({
        title: '  ',
        sourceBranch: 'mice1',
        targetBranch: 'main',
      }),
      'mice1 → main',
    )
  })
})
