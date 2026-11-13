import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifySigningChallenge } from './signingChallenge'

test('09 step-up: reauthUrl yields Confirm it’s you interstitial', () => {
  const c = classifySigningChallenge(
    401,
    { error: 'reauthentication_required', reauthUrl: '/auth/reauth?max_age=60&next=%2Fsettings' },
    { resumePath: '/settings' },
  )
  assert.ok(c)
  assert.equal(c.kind, 'step_up')
  assert.equal(c.title, "Confirm it's you")
  assert.match(c.message, /fresh sign-in/i)
  assert.equal(c.continueUrl, '/auth/reauth?max_age=60&next=%2Fsettings')
})

test('20 idle: session_idle yields Session idle interstitial with reauth Continue', () => {
  const c = classifySigningChallenge(
    401,
    { error: 'session_idle', message: 'Session idle for 20+ minutes, re-authenticate required' },
    { resumePath: '/settings/access-review' },
  )
  assert.ok(c)
  assert.equal(c.kind, 'session_idle')
  assert.equal(c.title, 'Session idle')
  assert.match(c.message, /idle/i)
  assert.match(c.continueUrl ?? '', /\/auth\/reauth\?max_age=60/)
  assert.match(c.continueUrl ?? '', /settings%2Faccess-review|settings\/access-review/)
})

test('52 evidence: incomplete MFA claims yield MFA required interstitial', () => {
  const c = classifySigningChallenge(
    403,
    { error: 'MFA required for electronic signature', reason: 'acr_missing' },
    { resumePath: '/' },
  )
  assert.ok(c)
  assert.equal(c.kind, 'mfa_required')
  assert.equal(c.title, 'MFA required')
  assert.equal(c.evidenceReason, 'acr_missing')
  assert.match(c.message, /acr missing/i)
  assert.ok(c.continueUrl)
})

test('non-challenge errors return null', () => {
  assert.equal(classifySigningChallenge(400, { error: 'Content changed' }), null)
  assert.equal(classifySigningChallenge(500, { error: 'oops' }), null)
})
