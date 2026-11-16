import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AUDIT_UNAVAILABLE_MESSAGE,
  AUDIT_UNAVAILABLE_RETRY_AFTER_SEC,
  AUDIT_UNAVAILABLE_STATUS,
  auditUnavailableJson,
  auditUnavailablePayload,
  auditUnavailableResponse,
} from './auditFailClosed.js'

describe('auditFailClosed', () => {
  it('exposes one canonical user-facing message', () => {
    assert.equal(AUDIT_UNAVAILABLE_MESSAGE, 'audit unavailable, nothing was saved')
    assert.equal(auditUnavailablePayload().error.detail, AUDIT_UNAVAILABLE_MESSAGE)
    assert.equal(auditUnavailableJson().error, AUDIT_UNAVAILABLE_MESSAGE)
  })

  it('builds the oxen-shaped 503 payload for proxy callers', () => {
    assert.deepEqual(auditUnavailablePayload(), {
      status: 'error',
      status_message: 'audit_unavailable',
      error: { detail: AUDIT_UNAVAILABLE_MESSAGE },
    })
  })

  it('returns a 503 Response with retry-after and the payload body', async () => {
    const res = auditUnavailableResponse()
    assert.equal(res.status, AUDIT_UNAVAILABLE_STATUS)
    assert.equal(res.headers.get('content-type'), 'application/json')
    assert.equal(res.headers.get('retry-after'), AUDIT_UNAVAILABLE_RETRY_AFTER_SEC)
    assert.deepEqual(await res.json(), auditUnavailablePayload())
  })
})
