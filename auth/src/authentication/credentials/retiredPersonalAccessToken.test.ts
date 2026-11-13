import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyBearerCredential,
  CLI_CREDENTIAL_PREFIX,
  isRetiredPersonalAccessToken,
  RETIRED_PAT_PREFIX,
} from './retiredPersonalAccessToken.js'

describe('retired personal access tokens', () => {
  it('classifies bearers by prefix before any credential lookup', () => {
    assert.equal(classifyBearerCredential(`${RETIRED_PAT_PREFIX}retired`), 'retired_pat')
    assert.equal(classifyBearerCredential('  mice_pat_x  '), 'retired_pat')
    assert.equal(classifyBearerCredential(`${CLI_CREDENTIAL_PREFIX}alive`), 'cli')
    assert.equal(classifyBearerCredential('opaque-session'), 'unknown')
    assert.equal(classifyBearerCredential(''), 'unknown')
  })

  it('recognizes the legacy mice_pat_ prefix and ignores surrounding space', () => {
    assert.equal(isRetiredPersonalAccessToken(`${RETIRED_PAT_PREFIX}retired`), true)
    assert.equal(isRetiredPersonalAccessToken('  mice_pat_x  '), true)
    assert.equal(isRetiredPersonalAccessToken('mice_cli_alive'), false)
    assert.equal(isRetiredPersonalAccessToken(''), false)
  })
})
