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

  it('keeps the stored email primary and notes the current email when they differ', () => {
    assert.deepEqual(decideCommitEmailDisplay('alice@lab.test', 'jane@lab.test'), {
      email: 'alice@lab.test',
      source: 'stored',
      current: 'jane@lab.test',
    })
  })

  it('returns nothing when the commit has no email and the author is unresolved', () => {
    assert.equal(decideCommitEmailDisplay(undefined, undefined), undefined)
    assert.equal(decideCommitEmailDisplay('', undefined), undefined)
  })

  it('keeps shownCommitEmail as the primary (stored) address', () => {
    assert.equal(shownCommitEmail('alice@lab.test', 'jane@lab.test'), 'alice@lab.test')
    assert.equal(shownCommitEmail('alice@lab.test', undefined), 'alice@lab.test')
  })
})
