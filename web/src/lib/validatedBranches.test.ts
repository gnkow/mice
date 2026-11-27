import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readDispositionFromBody } from './disposition'

/**
 * Mark-validated may include an explicit disposition map for Unset tip commits (ADR 0009).
 * Branch name remains required; disposition is optional when nothing is Unset.
 */
test('mark request body may carry branch and disposition', () => {
  const markBody = {
    branch: 'release',
    disposition: { abc: 'valid' as const, def: 'invalid' as const },
  }
  assert.equal(markBody.branch, 'release')
  assert.deepEqual(readDispositionFromBody(markBody), {
    abc: 'valid',
    def: 'invalid',
  })

  const unmarkBody = {}
  assert.equal(Object.keys(unmarkBody).length, 0)
})
