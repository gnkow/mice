import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shownCommitEmail } from './commitEmail.js'

describe('shown commit email', () => {
  it('shows the email stored on the commit', () => {
    assert.equal(shownCommitEmail('alice@lab.test', 'alice@lab.test'), 'alice@lab.test')
    assert.equal(shownCommitEmail('alice@lab.test', undefined), 'alice@lab.test')
  })

  it('shows the current email when it differs', () => {
    assert.equal(shownCommitEmail('alice@lab.test', 'jane@lab.test'), 'jane@lab.test')
  })
})
