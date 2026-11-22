import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { approverWhoLabel } from './ApproversSection'

const iss = 'http://localhost:8180/realms/mice'
const sub = 'a0000000-0000-4000-8000-000000000004'
const key = `${iss}|${sub}`

describe('approverWhoLabel', () => {
  it('prefers IdP display name over UUID for user seats', () => {
    assert.equal(
      approverWhoLabel(
        { kind: 'user', sub, iss },
        { names: { [key]: 'Regular User' }, emails: { [key]: 'mice_user@mice.com' } },
      ),
      'Regular User',
    )
  })

  it('uses directory hint when profiles have not loaded yet', () => {
    assert.equal(
      approverWhoLabel(
        { kind: 'user', sub, iss },
        { names: {}, emails: {} },
        { name: 'Regular User', email: 'mice_user@mice.com' },
      ),
      'Regular User',
    )
  })

  it('falls back to email local-part before truncating the sub', () => {
    assert.equal(
      approverWhoLabel(
        { kind: 'user', sub, iss },
        { names: {}, emails: { [key]: 'mice_user@mice.com' } },
      ),
      'mice_user',
    )
  })

  it('uses group display name when present', () => {
    assert.equal(
      approverWhoLabel(
        { kind: 'group', group: 'test|aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: 'Engineering' },
        { names: {}, emails: {} },
      ),
      'Engineering',
    )
  })
})
