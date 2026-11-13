import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseEmailLookupAuthors } from './emailLookupRequest.js'

describe('parseEmailLookupAuthors', () => {
  it('keeps only string authors and caps the batch', () => {
    assert.deepEqual(
      parseEmailLookupAuthors({ authors: ['a|1', 2, 'b|2', null, 'c|3'] }, 2),
      ['a|1', 'b|2'],
    )
  })

  it('returns an empty list for a missing or non-array authors field', () => {
    assert.deepEqual(parseEmailLookupAuthors(undefined), [])
    assert.deepEqual(parseEmailLookupAuthors({}), [])
    assert.deepEqual(parseEmailLookupAuthors({ authors: 'a|1' }), [])
  })
})
