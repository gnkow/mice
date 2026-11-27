import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { partitionTransferAccess } from '../../src/packages/authz/lib/repoTransferAccess.js'

describe('partitionTransferAccess', () => {
  it('keeps collaborators and approvers who are dest members; drops the rest', () => {
    const diff = partitionTransferAccess({
      collaborators: [
        { kind: 'user', key: 'test\u001falice', role: 'write' },
        { kind: 'user', key: 'test\u001fbob', role: 'read' },
        { kind: 'group', key: 'iss|g-keep', role: 'maintain' },
        { kind: 'group', key: 'iss|g-drop', role: 'write' },
      ],
      approvers: [
        { kind: 'user', key: 'test\u001falice' },
        { kind: 'user', key: 'test\u001fcarol' },
        { kind: 'group', key: 'iss|g-keep' },
      ],
      destMemberUserKeys: new Set(['test\u001falice']),
      destMemberGroupKeys: new Set(['iss|g-keep']),
      destBasePermission: 'none',
      destMembers: [
        { kind: 'user', key: 'test\u001falice' },
        { kind: 'group', key: 'iss|g-keep' },
      ],
    })

    assert.deepEqual(
      diff.kept.map((s) => `${s.seat}:${s.kind}:${s.key}`),
      [
        'approver:group:iss|g-keep',
        'approver:user:test\u001falice',
        'collaborator:group:iss|g-keep',
        'collaborator:user:test\u001falice',
      ],
    )
    assert.deepEqual(
      diff.dropped.map((s) => `${s.seat}:${s.kind}:${s.key}`),
      [
        'approver:user:test\u001fcarol',
        'collaborator:group:iss|g-drop',
        'collaborator:user:test\u001fbob',
      ],
    )
    assert.deepEqual(diff.newlyInheriting, [])
  })

  it('does not treat dest base permission as membership for keeping', () => {
    const diff = partitionTransferAccess({
      collaborators: [{ kind: 'user', key: 'test\u001fbob', role: 'read' }],
      approvers: [],
      destMemberUserKeys: new Set(),
      destMemberGroupKeys: new Set(),
      destBasePermission: 'read',
      destMembers: [{ kind: 'user', key: 'test\u001fdave' }],
    })
    assert.equal(diff.kept.length, 0)
    assert.equal(diff.dropped.length, 1)
    assert.deepEqual(diff.newlyInheriting, [
      { kind: 'user', key: 'test\u001fdave', viaBasePermission: 'read' },
    ])
  })

  it('keeps a group collaborator only when the group is a dest member', () => {
    const diff = partitionTransferAccess({
      collaborators: [{ kind: 'group', key: 'iss|lab', role: 'write' }],
      approvers: [],
      destMemberUserKeys: new Set(['test\u001falice']),
      destMemberGroupKeys: new Set(),
      destBasePermission: 'none',
      destMembers: [{ kind: 'user', key: 'test\u001falice' }],
    })
    assert.equal(diff.kept.length, 0)
    assert.equal(diff.dropped[0]?.key, 'iss|lab')
  })
})
