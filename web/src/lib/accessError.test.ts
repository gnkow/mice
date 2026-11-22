import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  describeAccessError,
  formatAccessError,
  isAccessDenial,
} from './accessError'

describe('describeAccessError', () => {
  it('names the required role and explains who can grant it', () => {
    const view = describeAccessError('Requires repo role read')
    assert.ok(view)
    assert.equal(view.permission, 'Read')
    assert.equal(view.title, 'Read access required to view data')
    assert.match(view.detail, /Maintain or Admin/)
    assert.match(view.detail, /Read role/)
  })

  it('uses an explicit purpose when provided', () => {
    const view = describeAccessError('Read access required', {
      purpose: 'view commits',
    })
    assert.ok(view)
    assert.equal(view.title, 'Read access required to view commits')
  })

  it('includes purpose for job denials', () => {
    const view = describeAccessError(
      'job.read requires repository read or job_read',
    )
    assert.ok(view)
    assert.equal(view.title, 'Read access required to view jobs')
    assert.match(view.detail, /job_read/)
  })

  it('rewrites already-humanized seat messages', () => {
    const view = describeAccessError(
      'You need a collaborator seat with at least write access on this repository to submit jobs.',
    )
    assert.ok(view)
    assert.equal(view.title, 'Write access required to submit jobs')
  })
})

describe('isAccessDenial', () => {
  it('detects permission denials', () => {
    assert.equal(isAccessDenial('Requires repo role read'), true)
    assert.equal(isAccessDenial('Read access required'), true)
    assert.equal(isAccessDenial('Disk full'), false)
  })
})

describe('formatAccessError', () => {
  it('joins title and detail for compact surfaces', () => {
    assert.match(
      formatAccessError('Requires repository read'),
      /^Read access required to view data\./,
    )
  })

  it('passes through unknown messages', () => {
    assert.equal(formatAccessError('Disk full'), 'Disk full')
  })
})
