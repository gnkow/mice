import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isApprovalConfirmation } from './cliDeviceApproval.ts'

test('accepts APPROVE or the full user code, case-insensitive', () => {
  assert.equal(isApprovalConfirmation('APPROVE', 'ABCD-EFGH'), true)
  assert.equal(isApprovalConfirmation('approve', 'ABCD-EFGH'), true)
  assert.equal(isApprovalConfirmation('ABCD-EFGH', 'ABCD-EFGH'), true)
  assert.equal(isApprovalConfirmation('abcd-efgh', 'ABCD-EFGH'), true)
})

test('rejects partial codes, empty input, and missing user code', () => {
  assert.equal(isApprovalConfirmation('APPROV', 'ABCD-EFGH'), false)
  assert.equal(isApprovalConfirmation('ABCD', 'ABCD-EFGH'), false)
  assert.equal(isApprovalConfirmation('', 'ABCD-EFGH'), false)
  assert.equal(isApprovalConfirmation('APPROVE', undefined), false)
})
