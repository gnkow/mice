import './db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, before } from 'node:test'
import { immudbConfig, openLedger } from './auditLedger.js'
import { initAudit, queryAudit, useAuditLedger } from './audit.js'
import {
  effectiveRegulatedConfig,
  evaluateRegulatedConfigAtStart,
  recordRegulatedConfigAtStart,
  recordRegulatedConfigChange,
  regulatedConfigDigest,
  regulatedConfigStatus,
  resetRegulatedConfigStatus,
} from './regulatedConfig.js'

describe('regulated configuration', () => {
  before(async () => {
    useAuditLedger(await openLedger(immudbConfig()))
    await initAudit()
  })

  it('exposes always-on GxP strict and reason / change-control policy', () => {
    const config = effectiveRegulatedConfig(
      {
        sessionIdleSec: 900,
        sessionTtlSec: 28800,
        cookieSecure: true,
        auditReasonMinLength: 10,
        auditVerifyIntervalSec: 3600,
        authzRequireTraining: false,
      },
      { IMMUDB_HA: 'true', BACKUP_TARGET: '/var/mice/backup' },
    )
    assert.equal(config.gxpStrict, true)
    assert.equal(config.session.idleSec, 900)
    assert.equal(config.session.absoluteSec, 28800)
    assert.equal(config.session.cookieSecure, true)
    assert.equal(config.reason.minLength, 10)
    assert.ok(config.reason.categories.includes('privileged_settings'))
    assert.ok(config.reason.requiredActions.includes('file.delete'))
    assert.ok(config.changeControl.requiredActions.includes('merge'))
    assert.ok(config.changeControl.alsoRequiredOn.includes('merge_signature'))
    assert.equal(config.changeControl.allocation, 'server')
    assert.equal(config.signature.allocation, 'ceremony')
    assert.equal(config.signature.meaning, 'Approved')
    assert.ok(config.signature.requiredActions.includes('merge'))
    assert.equal(config.audit.immudbHaAttested, true)
    assert.equal(config.backup.targetConfigured, true)
    assert.match(regulatedConfigDigest(config), /^sha256:[0-9a-f]{64}$/)
  })

  it('evaluateRegulatedConfigAtStart reports first-boot with no previous digest', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'mice-regulated-eval-'))
    const ev = evaluateRegulatedConfigAtStart({
      dataDir,
      envSnapshot: {
        sessionIdleSec: 900,
        sessionTtlSec: 28800,
        cookieSecure: true,
        auditReasonMinLength: 10,
        auditVerifyIntervalSec: 3600,
        authzRequireTraining: false,
      },
      processEnv: {},
    })
    assert.equal(ev.previousDigest, null)
    assert.equal(ev.changedFromPrevious, null)
    assert.match(ev.digest, /^sha256:[0-9a-f]{64}$/)
  })

  it('writes effective config to audit at instance start', async () => {
    resetRegulatedConfigStatus()
    const dataDir = mkdtempSync(join(tmpdir(), 'mice-regulated-start-'))
    const status = await recordRegulatedConfigAtStart({
      dataDir,
      envSnapshot: {
        sessionIdleSec: 600,
        sessionTtlSec: 28800,
        cookieSecure: false,
        auditReasonMinLength: 12,
        auditVerifyIntervalSec: 3600,
        authzRequireTraining: true,
      },
      processEnv: {},
    })
    assert.equal(status.config.session.idleSec, 600)
    assert.equal(status.config.reason.minLength, 12)
    assert.equal(status.changedFromPrevious, null)
    assert.equal(regulatedConfigStatus()?.digest, status.digest)

    const { events } = await queryAudit({ action: 'system.regulated_config.start', limit: 5 })
    assert.ok(
      events.some(
        (e) =>
          e.action === 'system.regulated_config.start' &&
          (e.detail?.config as { reason?: { minLength?: number } } | undefined)?.reason?.minLength === 12,
      ),
    )
  })

  it('audits a change when the digest differs from the previous start', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'mice-regulated-change-'))
    const base = {
      sessionIdleSec: 900,
      sessionTtlSec: 28800,
      cookieSecure: true,
      auditReasonMinLength: 10,
      auditVerifyIntervalSec: 3600,
      authzRequireTraining: false,
    }
    await recordRegulatedConfigAtStart({ dataDir, envSnapshot: base, processEnv: {} })
    const second = await recordRegulatedConfigAtStart({
      dataDir,
      envSnapshot: { ...base, auditReasonMinLength: 20 },
      processEnv: {},
    })
    assert.equal(second.changedFromPrevious, true)
    const { events } = await queryAudit({ action: 'system.regulated_config.change', limit: 10 })
    assert.ok(
      events.some(
        (e) =>
          e.action === 'system.regulated_config.change' &&
          e.detail?.source === 'restart' &&
          (e.detail?.config as { reason?: { minLength?: number } } | undefined)?.reason?.minLength === 20,
      ),
    )
  })

  it('audits an explicit runtime regulated-config change', async () => {
    await recordRegulatedConfigChange({
      source: 'authz.require_training',
      namespace: 'acme',
      previous: { requireTraining: false },
      next: { requireTraining: true },
      actor: { sub: 'admin', iss: 'https://idp.test', email: 'a@test', name: 'Admin' },
    })
    const { events } = await queryAudit({ action: 'system.regulated_config.change', limit: 10 })
    assert.ok(
      events.some(
        (e) =>
          e.namespace === 'acme' &&
          e.detail?.source === 'authz.require_training',
      ),
    )
  })
})
