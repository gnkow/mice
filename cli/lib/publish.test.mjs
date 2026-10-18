import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { commitsEqual, parsePushRef } from './publish.mjs'

describe('parsePushRef', () => {
  it('defaults remote to origin and branch empty', () => {
    assert.deepEqual(parsePushRef(['push']), {
      remoteName: 'origin',
      branch: '',
    })
  })

  it('reads oxen push remote branch', () => {
    assert.deepEqual(parsePushRef(['push', 'origin', 'main']), {
      remoteName: 'origin',
      branch: 'main',
    })
  })
})

describe('commitsEqual', () => {
  it('matches short and full hex forms', () => {
    const full = 'e7b06a5f14e31df34c258e58230c3524'
    assert.equal(commitsEqual(full, full), true)
    assert.equal(commitsEqual(full, full.slice(0, 8)), true)
    assert.equal(commitsEqual(full.slice(0, 7), full), true)
    assert.equal(commitsEqual(full, 'deadbeef'), false)
  })
})
