import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { appendAudit } from './audit.js'
import { REASON_CATEGORIES, reasonRequiredActions } from './auditReason.js'
import { immudbHaAttested } from './auditOutage.js'
import { env } from './env.js'

const DIGEST_FILE = 'regulated-config.digest'

export type EffectiveRegulatedConfig = {
  /** GxP controls are always on (Q10); not a deploy-time toggle. */
  gxpStrict: true
  session: {
    idleSec: number
    absoluteSec: number
    cookieSecure: boolean
  }
  reason: {
    minLength: number
    categories: readonly string[]
    requiredActions: string[]
  }
  changeControl: {
    /** Same mutation classes as the reason policy, plus merge signatures. Ids are server-minted. */
    requiredActions: string[]
    alsoRequiredOn: string[]
    allocation: 'server'
  }
  signature: {
    /** Same mutation classes as the reason policy; Part 11 ceremony before the mutation runs. */
    requiredActions: string[]
    meaning: 'Approved'
    allocation: 'ceremony'
  }
  audit: {
    immudbHaAttested: boolean
    verifyIntervalSec: number
  }
  backup: {
    targetConfigured: boolean
  }
  authz: {
    requireTraining: boolean
  }
}

export type RegulatedConfigStatus = {
  config: EffectiveRegulatedConfig
  digest: string
  recordedAt: string
  changedFromPrevious: boolean | null
}

let lastStatus: RegulatedConfigStatus | null = null

/** Builds the effective regulated configuration from process env and fixed policy. */
export function effectiveRegulatedConfig(
  e: {
    sessionIdleSec: number
    sessionTtlSec: number
    cookieSecure: boolean
    auditReasonMinLength: number
    auditVerifyIntervalSec: number
    authzRequireTraining: boolean
  } = env,
  src: Record<string, string | undefined> = process.env,
): EffectiveRegulatedConfig {
  const requiredActions = reasonRequiredActions()
  return {
    gxpStrict: true,
    session: {
      idleSec: e.sessionIdleSec,
      absoluteSec: e.sessionTtlSec,
      cookieSecure: e.cookieSecure,
    },
    reason: {
      minLength: e.auditReasonMinLength,
      categories: [...REASON_CATEGORIES],
      requiredActions,
    },
    changeControl: {
      requiredActions,
      alsoRequiredOn: ['merge_signature'],
      allocation: 'server',
    },
    signature: {
      requiredActions,
      meaning: 'Approved',
      allocation: 'ceremony',
    },
    audit: {
      immudbHaAttested: immudbHaAttested(src),
      verifyIntervalSec: e.auditVerifyIntervalSec,
    },
    backup: {
      targetConfigured: Boolean(src.BACKUP_TARGET?.trim()),
    },
    authz: {
      requireTraining: e.authzRequireTraining,
    },
  }
}

export function regulatedConfigDigest(config: EffectiveRegulatedConfig): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(config), 'utf8').digest('hex')}`
}

export function regulatedConfigStatus(): RegulatedConfigStatus | null {
  return lastStatus
}

export function resetRegulatedConfigStatus(): void {
  lastStatus = null
}

function digestPath(dataDir: string): string {
  return join(dataDir, DIGEST_FILE)
}

function readPreviousDigest(dataDir: string): string | null {
  try {
    const raw = readFileSync(digestPath(dataDir), 'utf8').trim()
    return raw || null
  } catch {
    return null
  }
}

function writeDigest(dataDir: string, digest: string): void {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(digestPath(dataDir), `${digest}\n`)
}

export type RegulatedConfigEvaluation = {
  config: EffectiveRegulatedConfig
  digest: string
  previousDigest: string | null
  changedFromPrevious: boolean | null
}

export type RecordRegulatedConfigOpts = {
  dataDir?: string
  envSnapshot?: Parameters<typeof effectiveRegulatedConfig>[0]
  processEnv?: Record<string, string | undefined>
}

/**
 * Pure start-gate evaluation: effective config + digest vs previous boot digest.
 * Boot audit recording and the admin overview both consume this result.
 */
export function evaluateRegulatedConfigAtStart(
  opts?: RecordRegulatedConfigOpts,
): RegulatedConfigEvaluation {
  const dataDir = opts?.dataDir ?? env.dataDir
  const config = effectiveRegulatedConfig(opts?.envSnapshot, opts?.processEnv)
  const digest = regulatedConfigDigest(config)
  const previousDigest = readPreviousDigest(dataDir)
  const changedFromPrevious = previousDigest === null ? null : previousDigest !== digest
  return { config, digest, previousDigest, changedFromPrevious }
}

/**
 * Writes the effective regulated configuration to the audit trail at instance start.
 * When the digest differs from the previous boot, also records a change event.
 */
export async function recordRegulatedConfigAtStart(
  opts?: RecordRegulatedConfigOpts,
): Promise<RegulatedConfigStatus> {
  const dataDir = opts?.dataDir ?? env.dataDir
  const ev = evaluateRegulatedConfigAtStart(opts)

  lastStatus = {
    config: ev.config,
    digest: ev.digest,
    recordedAt: new Date().toISOString(),
    changedFromPrevious: ev.changedFromPrevious,
  }

  await appendAudit({
    actor: { sub: 'system', iss: 'mice', email: 'system@mice', name: 'Mice' },
    via: 'system',
    method: 'SYSTEM',
    path: '/boot',
    status: 200,
    action: 'system.regulated_config.start',
    message: 'Effective regulated configuration at start',
    detail: {
      config: ev.config,
      digest: ev.digest,
      changedFromPrevious: ev.changedFromPrevious,
      previousDigest: ev.previousDigest,
    },
  })

  if (ev.changedFromPrevious) {
    await appendAudit({
      actor: { sub: 'system', iss: 'mice', email: 'system@mice', name: 'Mice' },
      via: 'system',
      method: 'SYSTEM',
      path: '/boot',
      status: 200,
      action: 'system.regulated_config.change',
      message: 'Regulated configuration changed since previous start',
      detail: {
        config: ev.config,
        digest: ev.digest,
        previousDigest: ev.previousDigest,
        source: 'restart',
      },
    })
  }

  writeDigest(dataDir, ev.digest)
  return lastStatus
}

/**
 * Audits a runtime change to regulated configuration.
 * Keeps the admin overview on the instance-effective snapshot; change is trail-only.
 */
export async function recordRegulatedConfigChange(input: {
  source: string
  namespace?: string
  previous?: unknown
  next?: unknown
  actor?: { sub: string; iss: string; email: string; name: string }
}): Promise<void> {
  await appendAudit({
    actor: input.actor ?? {
      sub: 'system',
      iss: 'mice',
      email: 'system@mice',
      name: 'Mice',
    },
    via: input.actor ? 'session' : 'system',
    method: input.actor ? 'PATCH' : 'SYSTEM',
    path: input.namespace ? `/auth/namespaces/${input.namespace}` : '/boot',
    status: 200,
    action: 'system.regulated_config.change',
    message: 'Regulated configuration changed',
    namespace: input.namespace,
    detail: {
      source: input.source,
      previous: input.previous,
      next: input.next,
      effective: lastStatus?.config ?? effectiveRegulatedConfig(),
    },
  })
}
