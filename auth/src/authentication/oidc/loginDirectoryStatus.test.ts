import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  applyLoginDirectoryDecision,
  decideLoginDirectoryStatus,
  gateLoginDirectoryStatus,
} from './loginDirectoryStatus.js'

describe('decideLoginDirectoryStatus', () => {
  it('allows an enabled directory account and records reachable', () => {
    assert.deepEqual(decideLoginDirectoryStatus('enabled'), {
      allow: true,
      idpCheck: 'reachable',
    })
  })

  it('refuses a disabled account with 403 and records IdP-disabled', () => {
    assert.deepEqual(decideLoginDirectoryStatus('disabled'), {
      allow: false,
      httpStatus: 403,
      message: 'Your account has been disabled by the administrator.',
      recordDisabled: true,
      idpCheck: 'reachable',
      surface: 'disabled',
    })
  })

  it('refuses a missing account with 403 and does not record IdP-disabled', () => {
    assert.deepEqual(decideLoginDirectoryStatus('missing'), {
      allow: false,
      httpStatus: 403,
      message: 'Your account was not found in the directory.',
      recordDisabled: false,
      idpCheck: 'reachable',
      surface: 'missing',
    })
  })

  it('refuses when the directory is unreachable with 503 and records unreachable', () => {
    assert.deepEqual(decideLoginDirectoryStatus('error'), {
      allow: false,
      httpStatus: 503,
      message: 'IdP is unreachable. Login cannot be verified at this time.',
      recordDisabled: false,
      idpCheck: 'unreachable',
      surface: 'unreachable',
    })
  })
})

describe('applyLoginDirectoryDecision / gateLoginDirectoryStatus', () => {
  it('records reachable then allows enabled', async () => {
    const events: string[] = []
    const gate = await gateLoginDirectoryStatus('enabled', {
      recordIdpCheck: async (reachable) => {
        events.push(reachable ? 'reachable' : 'unreachable')
      },
      recordDisabled: async () => {
        events.push('disabled')
      },
    })
    assert.deepEqual(gate, { allow: true })
    assert.deepEqual(events, ['reachable'])
  })

  it('records reachable then IdP-disabled before refusing disabled', async () => {
    const events: string[] = []
    const gate = await applyLoginDirectoryDecision(decideLoginDirectoryStatus('disabled'), {
      recordIdpCheck: async (reachable) => {
        events.push(reachable ? 'reachable' : 'unreachable')
      },
      recordDisabled: async () => {
        events.push('disabled')
      },
    })
    assert.deepEqual(gate, {
      allow: false,
      httpStatus: 403,
      message: 'Your account has been disabled by the administrator.',
      surface: 'disabled',
    })
    assert.deepEqual(events, ['reachable', 'disabled'])
  })

  it('records reachable and skips IdP-disabled when missing', async () => {
    const events: string[] = []
    const gate = await gateLoginDirectoryStatus('missing', {
      recordIdpCheck: async (reachable) => {
        events.push(reachable ? 'reachable' : 'unreachable')
      },
      recordDisabled: async () => {
        events.push('disabled')
      },
    })
    assert.equal(gate.allow, false)
    if (gate.allow) return
    assert.equal(gate.httpStatus, 403)
    assert.deepEqual(events, ['reachable'])
  })

  it('records unreachable and never IdP-disabled on directory error (ticket 38)', async () => {
    const events: string[] = []
    const gate = await gateLoginDirectoryStatus('error', {
      recordIdpCheck: async (reachable) => {
        events.push(reachable ? 'reachable' : 'unreachable')
      },
      recordDisabled: async () => {
        events.push('disabled')
      },
    })
    assert.deepEqual(gate, {
      allow: false,
      httpStatus: 503,
      message: 'IdP is unreachable. Login cannot be verified at this time.',
      surface: 'unreachable',
    })
    assert.deepEqual(events, ['unreachable'])
  })
})
