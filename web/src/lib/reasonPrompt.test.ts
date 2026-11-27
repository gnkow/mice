import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeMutation } from './reasonPrompt'

test('labels branch delete and namespace settings update', () => {
  assert.match(summarizeMutation('DELETE', '/api/repos/ns/repo/branches/main'), /Delete branch/)
  assert.match(summarizeMutation('PATCH', '/auth/namespaces/demo'), /Update settings/)
})

test('labels repository rename from auth and oxen paths', () => {
  assert.equal(
    summarizeMutation('PATCH', '/auth/namespaces/demo/repos/sample', { name: 'assay' }),
    'Rename repository demo/sample → assay',
  )
  assert.equal(
    summarizeMutation('PATCH', '/api/repos/demo/sample', { repo_name: 'assay' }),
    'Rename repository demo/sample → assay',
  )
})

test('labels namespace rename from settings patch body', () => {
  assert.equal(
    summarizeMutation('PATCH', '/auth/namespaces/demo', { name: 'lab' }),
    'Rename namespace “demo” → “lab”',
  )
})

test('labels validated-branch mark and unmark', () => {
  assert.equal(
    summarizeMutation('POST', '/auth/repos/demo/assay/validated-branches', {
      branch: 'release',
    }),
    'Mark branch “release” validated on demo/assay',
  )
  assert.equal(
    summarizeMutation('DELETE', '/auth/repos/demo/assay/validated-branches/main'),
    'Unmark validated branch “main” on demo/assay',
  )
})

test('labels approver, signature revoke and seal-key mutations', () => {
  assert.match(summarizeMutation('PUT', '/auth/namespaces/demo/approvers'), /Assign an approver in namespace/)
  assert.match(summarizeMutation('DELETE', '/auth/namespaces/demo/repos/assay/approvers'), /Remove an approver from demo\/assay/)
  assert.match(
    summarizeMutation('POST', '/auth/merge-requests/abc/reject'),
    /Reject a merge request/,
  )
  assert.match(summarizeMutation('POST', '/auth/signatures/abcdef123456/revoke'), /Revoke signature abcdef12…/)
  assert.match(
    summarizeMutation('POST', '/auth/signatures/abcdef123456/revocations/rev-1/revert'),
    /Revert revocation on signature abcdef12…/,
  )
  assert.equal(
    summarizeMutation('POST', '/auth/repos/demo/assay/commits/disposition', {
      disposition: { abc: 'valid' },
    }),
    'Sign commit disposition map on demo/assay',
  )
  assert.match(summarizeMutation('POST', '/auth/admin/seal-keys/rotate'), /Rotate the session cookie seal key/)
  assert.match(summarizeMutation('POST', '/auth/admin/seal-keys/rotate/emergency'), /Emergency-rotate/)
})

test('labels grants, announcements, custom roles and admin ops', () => {
  assert.equal(summarizeMutation('POST', '/auth/grants/role'), 'Grant or change a formal role')
  assert.equal(
    summarizeMutation('POST', '/auth/announcements', { title: 'Outage' }),
    'Publish announcement “Outage”',
  )
  assert.equal(
    summarizeMutation('POST', '/auth/namespaces/demo/custom-roles/namespace', {
      name: 'reviewer',
    }),
    'Create namespace role “reviewer” in “demo”',
  )
  assert.equal(
    summarizeMutation('POST', '/auth/instance/permissions'),
    'Change instance permissions',
  )
  assert.equal(
    summarizeMutation('POST', '/auth/admin/mice-suspension/lift'),
    'Lift Mice suspension for a principal',
  )
  assert.equal(summarizeMutation('DELETE', '/auth/meta'), 'Delete metadata')
})
