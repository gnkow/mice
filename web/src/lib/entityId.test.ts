import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { entityIdCopyLabel, entityIdDisplay, entityIdLabel, entityIdTitle } from './entityId'

describe('entityId helpers', () => {
  it('labels kinds for tooltips and copy controls', () => {
    assert.equal(entityIdLabel('repository'), 'Repository ID')
    assert.equal(entityIdTitle('namespace', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'),
      'Namespace ID aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
    assert.match(
      entityIdCopyLabel('job', 'job-1'),
      /Job ID job-1\. Click to copy\./,
    )
  })

  it('shows the full id with no truncation', () => {
    assert.equal(
      entityIdDisplay('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'),
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    )
    assert.equal(entityIdDisplay('short'), 'short')
    assert.equal(entityIdDisplay('  padded  '), 'padded')
  })
})
