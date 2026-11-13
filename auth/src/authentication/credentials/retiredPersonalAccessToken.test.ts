import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isRetiredPersonalAccessToken,
  RETIRED_PAT_PREFIX,
} from './retiredPersonalAccessToken.js'

describe('retired personal access tokens', () => {
  it('recognizes the legacy mice_pat_ prefix and ignores surrounding space', () => {
    assert.equal(isRetiredPersonalAccessToken(`${RETIRED_PAT_PREFIX}retired`), true)
    assert.equal(isRetiredPersonalAccessToken('  mice_pat_x  '), true)
    assert.equal(isRetiredPersonalAccessToken('mice_cli_alive'), false)
    assert.equal(isRetiredPersonalAccessToken(''), false)
  })
})
