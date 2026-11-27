import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  MERGE_COMMIT_DISPOSITION_KEY,
  coerceDispositionForSigner,
  defaultDispositionMap,
  readDispositionFromBody,
  signerAuthoredCommit,
} from './disposition'

describe('defaultDispositionMap', () => {
  it('defaults listed commits to valid and optionally the merge sentinel', () => {
    assert.deepEqual(defaultDispositionMap(['a', 'b']), { a: 'valid', b: 'valid' })
    assert.deepEqual(defaultDispositionMap(['a'], { includeMergeCommit: true }), {
      a: 'valid',
      [MERGE_COMMIT_DISPOSITION_KEY]: 'valid',
    })
  })
})

describe('signerAuthoredCommit', () => {
  it('matches iss|sub author keys', () => {
    assert.equal(
      signerAuthoredCommit({ iss: 'mice-dev', sub: 'mice' }, 'mice-dev|mice'),
      true,
    )
    assert.equal(
      signerAuthoredCommit({ iss: 'mice-dev', sub: 'mice' }, 'other|user'),
      false,
    )
  })
})

describe('readDispositionFromBody', () => {
  it('reads disposition or dispositionMap', () => {
    assert.deepEqual(readDispositionFromBody({ disposition: { a: 'valid', b: 'invalid' } }), {
      a: 'valid',
      b: 'invalid',
    })
    assert.deepEqual(readDispositionFromBody({ dispositionMap: { c: 'invalid' } }), {
      c: 'invalid',
    })
    assert.equal(readDispositionFromBody({ branch: 'main' }), null)
  })
})

describe('coerceDispositionForSigner', () => {
  it('forces Invalid when the signer authored a Valid row', () => {
    const coerced = coerceDispositionForSigner(
      { a: 'valid', b: 'valid' },
      [
        { id: 'a', message: 'mine', author: 'mice-dev|mice' },
        { id: 'b', message: 'theirs', author: 'other|user' },
      ],
      { iss: 'mice-dev', sub: 'mice' },
    )
    assert.deepEqual(coerced, { a: 'invalid', b: 'valid' })
  })
})
