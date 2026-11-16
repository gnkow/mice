import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { IdpCheckRecord } from '../compliance/idpOutage.js'
import {
  applyLoginDirectoryDecision,
  decideLoginDirectoryStatus,
  gateLoginDirectoryStatus,
  settleLoginDirectoryFromDirectory,
  settleLoginDirectoryStatus,
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

describe('settleLoginDirectoryStatus', () => {
  it('shapes a reachable IdP check record and allows enabled', async () => {
    const checks: IdpCheckRecord[] = []
    const gate = await settleLoginDirectoryStatus('enabled', {
      now: 1_700_000_000_000,
      requestId: 'req-login',
      recordIdpCheck: async (rec) => {
        checks.push(rec)
      },
      recordDisabled: async () => {
        assert.fail('enabled must not record IdP-disabled')
      },
    })
    assert.deepEqual(gate, { allow: true })
    assert.deepEqual(checks, [{ reachable: true, at: 1_700_000_000_000 }])
  })

  it('shapes an unreachable login check and refuses directory error', async () => {
    const checks: IdpCheckRecord[] = []
    let disabled = 0
    const gate = await settleLoginDirectoryStatus('error', {
      now: 42,
      requestId: 'login-r1',
      recordIdpCheck: async (rec) => {
        checks.push(rec)
      },
      recordDisabled: async () => {
        disabled += 1
      },
    })
    assert.deepEqual(gate, {
      allow: false,
      httpStatus: 503,
      message: 'IdP is unreachable. Login cannot be verified at this time.',
      surface: 'unreachable',
    })
    assert.deepEqual(checks, [
      { reachable: false, at: 42, check: 'login', requestId: 'login-r1' },
    ])
    assert.equal(disabled, 0)
  })

  it('records IdP-disabled after a reachable check when the account is disabled', async () => {
    const events: string[] = []
    const gate = await settleLoginDirectoryStatus('disabled', {
      now: 9,
      requestId: 'd1',
      recordIdpCheck: async (rec) => {
        events.push(rec.reachable ? 'reachable' : 'unreachable')
      },
      recordDisabled: async () => {
        events.push('disabled')
      },
    })
    assert.equal(gate.allow, false)
    assert.deepEqual(events, ['reachable', 'disabled'])
  })
})

describe('settleLoginDirectoryFromDirectory', () => {
  it('looks up the Principal then settles status in one call', async () => {
    const checks: IdpCheckRecord[] = []
    const { account, gate } = await settleLoginDirectoryFromDirectory({
      directory: {
        userStatus: async (sub) => {
          assert.equal(sub, 'user-1')
          return { status: 'missing', name: '' }
        },
      },
      sub: 'user-1',
      now: 100,
      requestId: 'lookup-1',
      recordIdpCheck: async (rec) => {
        checks.push(rec)
      },
      recordDisabled: async () => {
        assert.fail('missing must not record IdP-disabled')
      },
    })
    assert.deepEqual(account, { status: 'missing', name: '' })
    assert.equal(gate.allow, false)
    if (gate.allow) return
    assert.equal(gate.surface, 'missing')
    assert.deepEqual(checks, [{ reachable: true, at: 100 }])
  })
})
