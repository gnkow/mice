import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  authorsFromCommits,
  decideSelfMerge,
  evaluateSelfMergeFromCommits,
  SELF_MERGE_FORBIDDEN,
} from './selfMerge.js'

describe('decideSelfMerge', () => {
  const alice = { iss: 'https://idp.example/', sub: 'alice' }
  const aliceAuthor = 'https://idp.example|alice'
  const bobAuthor = 'https://idp.example|bob'

  it('allows merge when no commit author matches the signer', () => {
    const d = decideSelfMerge(alice, [bobAuthor])
    assert.equal(d.allow, true)
  })

  it('forbids merge when the signer authored a commit in the range', () => {
    const d = decideSelfMerge(alice, [bobAuthor, aliceAuthor])
    assert.equal(d.allow, false)
    if (d.allow) return
    assert.equal(d.reason, SELF_MERGE_FORBIDDEN)
    assert.deepEqual(d.matchingAuthors, [aliceAuthor])
  })

  it('forbids merge when the signer matches any of several authors', () => {
    const d = decideSelfMerge(alice, [bobAuthor, aliceAuthor, 'https://idp.example|carol'])
    assert.equal(d.allow, false)
    if (d.allow) return
    assert.equal(d.reason, SELF_MERGE_FORBIDDEN)
  })

  it('treats trailing slash on issuer as the same Principal as commit author', () => {
    const d = decideSelfMerge({ iss: 'https://idp.example', sub: 'alice' }, [aliceAuthor])
    assert.equal(d.allow, false)
  })

  it('allows merge when the author list is empty', () => {
    assert.equal(decideSelfMerge(alice, []).allow, true)
  })
})

describe('evaluateSelfMergeFromCommits', () => {
  const alice = { iss: 'https://idp.example/', sub: 'alice' }

  it('extracts authors from commits and decides in one step', () => {
    assert.equal(
      evaluateSelfMergeFromCommits(alice, [
        { author: 'https://idp.example|bob' },
        { author: 'https://idp.example|alice' },
      ]).allow,
      false,
    )
    assert.equal(
      evaluateSelfMergeFromCommits(alice, [{ author: 'https://idp.example|bob' }]).allow,
      true,
    )
  })

  it('ignores non-string author fields when extracting', () => {
    assert.deepEqual(authorsFromCommits([{ author: 1 }, { author: '  x  ' }, {}]), ['x'])
  })
})
