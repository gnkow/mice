import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeRefusalMessage } from './mergeRequests'

describe('mergeRefusalMessage (#73 self-merge)', () => {
  it('names the 4-eyes principle for self_merge refusals', () => {
    assert.match(mergeRefusalMessage('self_merge', 'fallback'), /4-eyes/i)
    assert.match(mergeRefusalMessage('self_merge', 'fallback'), /authored commits/i)
  })

  it('falls back when the code is unknown', () => {
    assert.equal(mergeRefusalMessage('nope', 'fallback text'), 'fallback text')
  })
})
