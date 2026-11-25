import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { knownAuditActions } from './auditLabels.js'
import {
  DEFAULT_AUDITOR_HIDDEN_ACTIONS,
  defaultAuditorHiddenActions,
  isHiddenFromAuditor,
  normalizeHiddenActions,
} from './auditVisibility.js'

describe('auditVisibility', () => {
  it('normalizes known hidden actions and rejects unknowns', () => {
    const ok = normalizeHiddenActions(['audit.browse', 'file.write', 'audit.browse'])
    assert.ok(!('error' in ok))
    assert.deepEqual(ok, ['audit.browse', 'file.write'])
    assert.match(
      (normalizeHiddenActions(['not.a.real.action']) as { error: string }).error,
      /Unknown audit action/,
    )
  })

  it('matches exact hidden actions for Auditor filtering', () => {
    assert.equal(isHiddenFromAuditor('audit.browse', ['audit.browse']), true)
    assert.equal(isHiddenFromAuditor('file.write', ['audit.browse']), false)
  })

  it('default hidden set covers login-style noise and stays within the catalogue', () => {
    const defaults = defaultAuditorHiddenActions()
    const known = new Set(knownAuditActions().map((a) => a.value))
    assert.ok(defaults.includes('auth.login'))
    assert.ok(defaults.includes('audit.browse'))
    assert.ok(defaults.includes('commit.upload'))
    assert.ok(!defaults.includes('file.write'))
    assert.ok(!defaults.includes('merge'))
    assert.ok(!defaults.includes('esign.revoked'))
    assert.ok(!defaults.includes('audit.export'))
    for (const a of DEFAULT_AUDITOR_HIDDEN_ACTIONS) {
      if (known.has(a)) assert.ok(defaults.includes(a))
    }
  })
})
