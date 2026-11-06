import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_CHANGE_CONTROL_PATTERN,
  matchesChangeControlPattern,
  mutationNeedsChangeControl,
  resolveChangeControl,
} from './changeControl.js'

describe('matchesChangeControlPattern', () => {
  it('matches ids against the full pattern', () => {
    assert.equal(matchesChangeControlPattern('CC-2026-114', '^CC-\\d{4}-\\d+$'), true)
    assert.equal(matchesChangeControlPattern('cc-2026-114', '^CC-\\d{4}-\\d+$'), false)
    assert.equal(matchesChangeControlPattern('CC-2026-114-extra', '^CC-\\d{4}-\\d+$'), false)
  })

  it('rejects empty id or invalid pattern source', () => {
    assert.equal(matchesChangeControlPattern('', DEFAULT_CHANGE_CONTROL_PATTERN), false)
    assert.equal(matchesChangeControlPattern('CC-1', '(unclosed'), false)
  })
})

describe('resolveChangeControl', () => {
  const pattern = '^CC-\\d{4}-\\d+$'

  it('accepts a matching id when required', () => {
    const r = resolveChangeControl({ id: '  CC-2026-114  ', pattern, required: true })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.value, 'CC-2026-114')
  })

  it('refuses missing or invalid ids when required', () => {
    const missing = resolveChangeControl({ id: null, pattern, required: true })
    assert.equal(missing.ok, false)
    if (!missing.ok) assert.equal(missing.rejection.code, 'change_control_required')

    const bad = resolveChangeControl({ id: 'asdf', pattern, required: true })
    assert.equal(bad.ok, false)
    if (!bad.ok) assert.equal(bad.rejection.code, 'change_control_invalid')
  })

  it('skips validation when not required', () => {
    const r = resolveChangeControl({ id: undefined, pattern, required: false })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.value, undefined)
  })
})

describe('mutationNeedsChangeControl', () => {
  it('tracks the same update/delete classes as the reason policy; creates are exempt', () => {
    assert.equal(mutationNeedsChangeControl('file.delete'), true)
    assert.equal(mutationNeedsChangeControl('merge'), true)
    assert.equal(mutationNeedsChangeControl('privileged_settings'), true)
    assert.equal(mutationNeedsChangeControl('revocation'), true)
    assert.equal(mutationNeedsChangeControl('namespace.create'), false)
    assert.equal(mutationNeedsChangeControl('repo.create'), false)
    assert.equal(mutationNeedsChangeControl('file.write'), false)
  })
})
