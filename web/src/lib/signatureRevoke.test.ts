import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AuthzError } from './authzApi'
import { revocableSignatureId, revokedSignatureIds, revokeFailureMessage } from './signatureRevoke'

test('revocable only on signature-created events with an id', () => {
  assert.equal(revocableSignatureId('esign.created', { signatureId: 'sig-1' }), 'sig-1')
  assert.equal(revocableSignatureId('esign.created', {}), undefined)
  assert.equal(revocableSignatureId('esign.failed', { signatureId: 'sig-1' }), undefined)
})

test('collects ids from esign.revoked events', () => {
  const ids = revokedSignatureIds([
    { action: 'esign.created', detail: { signatureId: 'a' } },
    { action: 'esign.revoked', detail: { signatureId: 'b' } },
  ])
  assert.deepEqual([...ids], ['b'])
})

test('not_approver explains how to obtain the role', () => {
  const msg = revokeFailureMessage(new AuthzError('Approver role required', 403, 'not_approver'))
  assert.match(msg, /not an approver/i)
  assert.match(msg, /namespace Owner/)
})

test('other failures keep the server detail', () => {
  assert.equal(revokeFailureMessage(new AuthzError('boom', 500)), 'boom')
  assert.match(revokeFailureMessage(new AuthzError('nope', 403)), /Not allowed: nope/)
  assert.equal(revokeFailureMessage(new Error('offline')), 'offline')
})
