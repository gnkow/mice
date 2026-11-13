import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  allocateChangeControlId,
  mutationNeedsChangeControl,
  resolveChangeControl,
} from './changeControl.js'

describe('allocateChangeControlId', () => {
  it('mints a CC-YYYYMMDD-hex id', () => {
    const id = allocateChangeControlId(new Date('2026-11-13T12:00:00Z'))
    assert.match(id, /^CC-20261113-[0-9a-f]{8}$/)
  })
})

describe('resolveChangeControl', () => {
  it('mints when required and missing', () => {
    const value = resolveChangeControl({ id: null, required: true })
    assert.match(value!, /^CC-\d{8}-[0-9a-f]{8}$/)
  })

  it('keeps a non-empty client-supplied id when required', () => {
    assert.equal(resolveChangeControl({ id: '  CC-2026-114  ', required: true }), 'CC-2026-114')
  })

  it('skips when not required', () => {
    assert.equal(resolveChangeControl({ id: undefined, required: false }), undefined)
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
