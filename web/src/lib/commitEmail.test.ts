import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decideCommitEmailDisplay, shownCommitEmail } from './commitEmail.js'

describe('commit email display', () => {
  it('shows the email stored on the commit when it matches the current email', () => {
    assert.deepEqual(decideCommitEmailDisplay('alice@lab.test', 'alice@lab.test'), {
      email: 'alice@lab.test',
      source: 'stored',
    })
  })

  it('shows the email stored on the commit when the author is unresolved', () => {
    assert.deepEqual(decideCommitEmailDisplay('alice@lab.test', undefined), {
      email: 'alice@lab.test',
      source: 'stored',
    })
  })

  it('shows the current email when it differs from the stored email', () => {
    assert.deepEqual(decideCommitEmailDisplay('alice@lab.test', 'jane@lab.test'), {
      email: 'jane@lab.test',
      source: 'current',
    })
  })

  it('returns nothing when the commit has no email and the author is unresolved', () => {
    assert.equal(decideCommitEmailDisplay(undefined, undefined), undefined)
    assert.equal(decideCommitEmailDisplay('', undefined), undefined)
  })

  it('keeps shownCommitEmail as the string form of the display decision', () => {
    assert.equal(shownCommitEmail('alice@lab.test', 'jane@lab.test'), 'jane@lab.test')
    assert.equal(shownCommitEmail('alice@lab.test', undefined), 'alice@lab.test')
  })
})
