import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PendingSignedMutation } from '../lib/signingResume'
import { navigateAfterRepoMutation } from './RepoSettingsPage'

function intent(
  partial: Pick<PendingSignedMutation, 'method' | 'apiPath' | 'body'>,
): PendingSignedMutation {
  return {
    kind: 'signed_mutation',
    path: '/n/demo/r/sample/settings',
    at: Date.now(),
    ...partial,
  }
}

describe('navigateAfterRepoMutation', () => {
  it('sends rename to the new repo tree after AuthZ PATCH', () => {
    const calls: string[] = []
    const ok = navigateAfterRepoMutation(
      intent({
        method: 'PATCH',
        apiPath: '/auth/namespaces/demo/repos/sample',
        body: { name: 'sample-2' },
      }),
      'demo',
      'sample',
      (to) => calls.push(to),
    )
    assert.equal(ok, true)
    assert.deepEqual(calls, ['/n/demo/r/sample-2/tree/main'])
  })

  it('ignores same-name rename PATCH', () => {
    const calls: string[] = []
    const ok = navigateAfterRepoMutation(
      intent({
        method: 'PATCH',
        apiPath: '/auth/namespaces/demo/repos/sample',
        body: { name: 'sample' },
      }),
      'demo',
      'sample',
      (to) => calls.push(to),
    )
    assert.equal(ok, false)
    assert.deepEqual(calls, [])
  })

  it('sends AuthZ transfer propose to the target namespace tree', () => {
    const calls: string[] = []
    const ok = navigateAfterRepoMutation(
      intent({
        method: 'POST',
        apiPath: '/auth/namespaces/demo/repos/sample/transfer',
        body: { targetNamespace: 'other' },
      }),
      'demo',
      'sample',
      (to) => calls.push(to),
    )
    assert.equal(ok, true)
    assert.deepEqual(calls, ['/n/other/r/sample/tree/main'])
  })

  it('sends AuthZ transfer accept to the target namespace tree', () => {
    const calls: string[] = []
    const ok = navigateAfterRepoMutation(
      intent({
        method: 'POST',
        apiPath: '/auth/namespaces/demo/repos/sample/transfer/accept',
        body: { targetNamespace: 'other' },
      }),
      'demo',
      'sample',
      (to) => calls.push(to),
    )
    assert.equal(ok, true)
    assert.deepEqual(calls, ['/n/other/r/sample/tree/main'])
  })

  it('ignores legacy oxen transfer resume paths', () => {
    const calls: string[] = []
    const ok = navigateAfterRepoMutation(
      intent({
        method: 'PATCH',
        apiPath: '/api/repos/demo/sample/transfer',
        body: { namespace: 'other' },
      }),
      'demo',
      'sample',
      (to) => calls.push(to),
    )
    assert.equal(ok, false)
    assert.deepEqual(calls, [])
  })

  it('sends delete to the repositories list', () => {
    const calls: string[] = []
    const ok = navigateAfterRepoMutation(
      intent({
        method: 'DELETE',
        apiPath: '/api/repos/demo/sample',
      }),
      'demo',
      'sample',
      (to) => calls.push(to),
    )
    assert.equal(ok, true)
    assert.deepEqual(calls, ['/repositories'])
  })

  it('ignores unrelated mutations', () => {
    const calls: string[] = []
    const ok = navigateAfterRepoMutation(
      intent({
        method: 'PUT',
        apiPath: '/auth/namespaces/demo/repos/sample/collaborators',
        body: { role: 'read' },
      }),
      'demo',
      'sample',
      (to) => calls.push(to),
    )
    assert.equal(ok, false)
    assert.deepEqual(calls, [])
  })
})
