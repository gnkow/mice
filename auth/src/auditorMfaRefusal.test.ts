import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth, withMfa } from './testSupport.js'

const t = isolatedAuth()
after(() => t.restore())

const { AUDITOR_MFA_REASON, auditorMfaRefusal, decideInstanceAction, preparePrincipal } = await import('./authz.js')

describe('auditorMfaRefusal (single gate rule)', () => {
  it('refuses only an Auditor-role principal without MFA evidence', async () => {
    const auditor = t.person('mfa-unit-auditor')
    const user = t.person('mfa-unit-user')
    await preparePrincipal(auditor)
    await preparePrincipal(user)
    await t.grantRole(auditor, 'auditor')
    await t.grantRole(user, 'user')

    assert.equal(await auditorMfaRefusal(auditor), AUDITOR_MFA_REASON)
    assert.equal(await auditorMfaRefusal(withMfa(auditor)), null)
    assert.equal(await auditorMfaRefusal(user), null)
    assert.equal(await auditorMfaRefusal(withMfa(user)), null)
  })

  it('does not re-apply the MFA rule inside decideInstanceAction (authenticate is the gate)', async () => {
    const auditor = t.person('mfa-unit-inst')
    await preparePrincipal(auditor)
    await t.grantRole(auditor, 'auditor')
    // Without MFA, audit.view is still allowed here — MFA refusal lives only in authenticate.
    const d = await decideInstanceAction(auditor, 'audit.view')
    assert.equal(d.allow, true)
  })
})
