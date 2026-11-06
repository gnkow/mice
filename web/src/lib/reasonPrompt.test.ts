import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeMutation } from './reasonPrompt'

test('labels branch delete and namespace settings update', () => {
  assert.match(summarizeMutation('DELETE', '/api/repos/ns/repo/branches/main'), /Delete branch/)
  assert.match(summarizeMutation('PATCH', '/auth/namespaces/demo'), /Update settings/)
})
