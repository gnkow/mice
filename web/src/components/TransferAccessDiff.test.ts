import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TransferAccessDiff } from '../lib/authzApi'
import {
  defaultTransferDiffTab,
  transferDiffTabCounts,
} from './TransferAccessDiff'

function diff(partial: Partial<TransferAccessDiff>): TransferAccessDiff {
  return {
    kept: [],
    dropped: [],
    newlyInheriting: [],
    ...partial,
  }
}

describe('defaultTransferDiffTab', () => {
  it('opens Dropped when anyone loses a seat', () => {
    assert.equal(
      defaultTransferDiffTab(
        diff({
          dropped: [
            {
              kind: 'user',
              key: 'iss|bob',
              role: 'write',
              seat: 'collaborator',
            },
          ],
        }),
      ),
      'dropped',
    )
  })

  it('opens Inheriting when only base-permission warnings exist', () => {
    assert.equal(
      defaultTransferDiffTab(
        diff({
          newlyInheriting: [
            { kind: 'user', key: 'iss|dave', viaBasePermission: 'read' },
          ],
        }),
      ),
      'inheriting',
    )
  })

  it('falls back to Kept when nothing changes', () => {
    assert.equal(defaultTransferDiffTab(diff({})), 'kept')
  })
})

describe('transferDiffTabCounts', () => {
  it('counts kept, dropped, and inheriting seats for tab badges', () => {
    assert.deepEqual(
      transferDiffTabCounts(
        diff({
          kept: [
            {
              kind: 'user',
              key: 'iss|alice',
              role: 'write',
              seat: 'collaborator',
            },
            { kind: 'user', key: 'iss|alice', seat: 'approver' },
          ],
          dropped: [
            {
              kind: 'user',
              key: 'iss|bob',
              role: 'read',
              seat: 'collaborator',
            },
          ],
          newlyInheriting: [
            { kind: 'user', key: 'iss|carol', viaBasePermission: 'read' },
            { kind: 'group', key: 'iss|lab', viaBasePermission: 'read' },
          ],
        }),
      ),
      { kept: 2, dropped: 1, inheriting: 2 },
    )
  })
})
