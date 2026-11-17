import assert from 'node:assert/strict'
import { test } from 'node:test'
import { suggestReasonCategory, summarizeMutation } from './reasonPrompt'

test('labels branch delete and namespace settings update', () => {
  assert.match(summarizeMutation('DELETE', '/api/repos/ns/repo/branches/main'), /Delete branch/)
  assert.match(summarizeMutation('PATCH', '/auth/namespaces/demo'), /Update settings/)
})

test('labels approver, signature revoke and seal-key mutations', () => {
  assert.match(summarizeMutation('PUT', '/auth/namespaces/demo/approvers'), /Assign an approver in namespace/)
  assert.match(summarizeMutation('DELETE', '/auth/namespaces/demo/repos/assay/approvers'), /Remove an approver from demo\/assay/)
  assert.match(summarizeMutation('POST', '/auth/signatures/abcdef123456/revoke'), /Revoke signature abcdef12…/)
  assert.match(summarizeMutation('POST', '/auth/admin/seal-keys/rotate'), /Rotate the session cookie seal key/)
  assert.match(summarizeMutation('POST', '/auth/admin/seal-keys/rotate/emergency'), /Emergency-rotate/)
})

test('suggests a reason category that matches the operation', () => {
  assert.equal(
    suggestReasonCategory({
      method: 'POST',
      path: '/auth/access-requests/abc',
      changeSummary: 'Decide an access request',
    }),
    'privileged_settings',
  )
  assert.equal(
    suggestReasonCategory({
      method: 'POST',
      path: '/auth/signatures/abcdef123456/revoke',
    }),
    'revocation',
  )
  assert.equal(
    suggestReasonCategory({
      method: 'DELETE',
      path: '/auth/namespaces/demo',
    }),
    'destructive',
  )
  assert.equal(
    suggestReasonCategory({
      method: 'PUT',
      path: '/api/repos/ns/repo/files/assay.csv',
      changeSummary: 'Update assay.csv in ns/repo',
    }),
    'data_correction',
  )
})
