import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { appendAudit } from './audit.js'

/**
 * Development / open-source release-manifest verifying key. Matching private key is
 * used by `scripts/sign-release-manifest.mjs`. Production releases replace this key
 * and re-sign the shipped manifest in CI.
 */
export const RELEASE_MANIFEST_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAhRwM0hX/wpWj989N5WO9X0TSmtJi3gLixajB4K9Uwlw=
-----END PUBLIC KEY-----
`

export const RELEASE_MANIFEST_FORMAT = 'mice-release-manifest/1' as const

export type ReleaseComponentId = 'idp_configuration' | 'search_index' | 'custom_verifiers'

export type ReleaseComponentIdentity = {
  version: string
  digest: string
}

export type ReleaseManifestBody = {
  format: typeof RELEASE_MANIFEST_FORMAT
  releaseVersion: string
  components: Record<ReleaseComponentId, ReleaseComponentIdentity>
}

export type SignedReleaseManifest = ReleaseManifestBody & { signature: string }

export type ReleaseManifestStatus = {
  present: boolean
  path?: string
  releaseVersion?: string
  signatureValid: boolean | null
  match: boolean | null
  mismatches: string[]
  components: Record<
    ReleaseComponentId,
    { expected?: string; actual: string; version: string }
  >
  checkedAt: string
  reason?: string
}

const COMPONENT_IDS: ReleaseComponentId[] = [
  'idp_configuration',
  'search_index',
  'custom_verifiers',
]

function sha256Digest(payload: string): string {
  return `sha256:${createHash('sha256').update(payload, 'utf8').digest('hex')}`
}

/**
 * Validated-release identities for the three components the manifest pins.
 * Digests change only when the validated contract of that component changes.
 */
export function liveReleaseComponents(): Record<ReleaseComponentId, ReleaseComponentIdentity> {
  return {
    idp_configuration: {
      version: '1',
      digest: sha256Digest(
        JSON.stringify({
          requiredAssuranceClaims: ['acr', 'amr', 'auth_time'],
          idTokenAlwaysVerified: true,
          driftDetection: true,
          baselineAdminSurface: true,
        }),
      ),
    },
    search_index: {
      version: '1',
      digest: sha256Digest(
        JSON.stringify({
          engine: 'derived-postgres-fts',
          querySyntax: ['type:', 'tag:', 'label.', 'quoted', 'negation'],
          authzScopeBeforePaging: true,
        }),
      ),
    },
    custom_verifiers: {
      version: '1',
      digest: sha256Digest(
        JSON.stringify({
          ledger: 'immudb-tx-v1-alh',
          entryRoot: 'single-entry-merkle-v1',
          module: 'mice-auditLedger',
        }),
      ),
    },
  }
}

export function compareReleaseComponents(
  expected: Record<ReleaseComponentId, ReleaseComponentIdentity>,
  actual: Record<ReleaseComponentId, ReleaseComponentIdentity>,
): { match: boolean; mismatches: string[] } {
  const mismatches: string[] = []
  for (const id of COMPONENT_IDS) {
    if (expected[id].digest !== actual[id].digest) {
      mismatches.push(
        `${id}: expected ${expected[id].digest}, actual ${actual[id].digest}`,
      )
    } else if (expected[id].version !== actual[id].version) {
      mismatches.push(
        `${id}: version expected ${expected[id].version}, actual ${actual[id].version}`,
      )
    }
  }
  return { match: mismatches.length === 0, mismatches }
}

function canonicalBody(body: ReleaseManifestBody): Buffer {
  const ordered: ReleaseManifestBody = {
    format: body.format,
    releaseVersion: body.releaseVersion,
    components: {
      idp_configuration: body.components.idp_configuration,
      search_index: body.components.search_index,
      custom_verifiers: body.components.custom_verifiers,
    },
  }
  return Buffer.from(JSON.stringify(ordered), 'utf8')
}

/** Signs a manifest body with an Ed25519 PKCS#8 private key (PEM). */
export function signReleaseManifest(body: ReleaseManifestBody, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem)
  return cryptoSign(null, canonicalBody(body), key).toString('base64url')
}

/** Verifies an Ed25519 signature over the canonical manifest body. */
export function verifyReleaseManifestSignature(
  body: ReleaseManifestBody,
  signature: string,
  publicKeyPem: string,
): boolean {
  try {
    const key = createPublicKey(publicKeyPem)
    return cryptoVerify(null, canonicalBody(body), key, Buffer.from(signature, 'base64url'))
  } catch {
    return false
  }
}

/** Builds a signable body from live component digests (shared by ship script + tests). */
export function buildReleaseManifestBody(releaseVersion: string): ReleaseManifestBody {
  return {
    format: RELEASE_MANIFEST_FORMAT,
    releaseVersion,
    components: liveReleaseComponents(),
  }
}

export function loadSignedReleaseManifest(
  path: string,
  publicKeyPem: string = RELEASE_MANIFEST_PUBLIC_KEY_PEM,
):
  | { ok: true; manifest: SignedReleaseManifest }
  | { ok: false; reason: string } {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return { ok: false, reason: `release manifest not readable at ${path}` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'release manifest is not valid JSON' }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'release manifest has invalid shape' }
  }
  const obj = parsed as Record<string, unknown>
  if (obj.format !== RELEASE_MANIFEST_FORMAT) {
    return { ok: false, reason: `unsupported release manifest format: ${String(obj.format)}` }
  }
  if (typeof obj.releaseVersion !== 'string' || typeof obj.signature !== 'string') {
    return { ok: false, reason: 'release manifest missing releaseVersion or signature' }
  }
  const components = obj.components as Record<string, ReleaseComponentIdentity> | undefined
  if (!components) return { ok: false, reason: 'release manifest missing components' }
  for (const id of COMPONENT_IDS) {
    const c = components[id]
    if (!c || typeof c.version !== 'string' || typeof c.digest !== 'string') {
      return { ok: false, reason: `release manifest missing component ${id}` }
    }
  }
  const body: ReleaseManifestBody = {
    format: RELEASE_MANIFEST_FORMAT,
    releaseVersion: obj.releaseVersion,
    components: {
      idp_configuration: components.idp_configuration!,
      search_index: components.search_index!,
      custom_verifiers: components.custom_verifiers!,
    },
  }
  if (!verifyReleaseManifestSignature(body, obj.signature, publicKeyPem)) {
    return { ok: false, reason: 'release manifest signature is invalid' }
  }
  return { ok: true, manifest: { ...body, signature: obj.signature } }
}

let lastStatus: ReleaseManifestStatus | null = null

export function releaseManifestStatus(): ReleaseManifestStatus | null {
  return lastStatus
}

export function resetReleaseManifestStatus(): void {
  lastStatus = null
}

function statusFromLive(
  partial: Omit<ReleaseManifestStatus, 'components' | 'checkedAt'> & {
    components?: ReleaseManifestStatus['components']
  },
): ReleaseManifestStatus {
  const live = liveReleaseComponents()
  const components =
    partial.components ??
    Object.fromEntries(
      COMPONENT_IDS.map((id) => [id, { actual: live[id].digest, version: live[id].version }]),
    ) as ReleaseManifestStatus['components']
  return {
    ...partial,
    components,
    checkedAt: new Date().toISOString(),
  }
}

/**
 * Loads the shipped signed manifest (if any), verifies its signature, and compares
 * live component digests. Does not refuse start on mismatch — callers audit and surface it.
 */
export async function verifyReleaseManifestAt(opts: {
  path: string | undefined
  publicKeyPem?: string
}): Promise<ReleaseManifestStatus> {
  const live = liveReleaseComponents()
  if (!opts.path?.trim()) {
    lastStatus = statusFromLive({
      present: false,
      signatureValid: null,
      match: null,
      mismatches: [],
      reason: 'RELEASE_MANIFEST_PATH not set',
    })
    return lastStatus
  }
  const path = opts.path.trim()
  const loaded = loadSignedReleaseManifest(path, opts.publicKeyPem ?? RELEASE_MANIFEST_PUBLIC_KEY_PEM)
  if (!loaded.ok) {
    lastStatus = statusFromLive({
      present: false,
      path,
      signatureValid: false,
      match: false,
      mismatches: [loaded.reason],
      reason: loaded.reason,
    })
    return lastStatus
  }
  const compared = compareReleaseComponents(loaded.manifest.components, live)
  const components = Object.fromEntries(
    COMPONENT_IDS.map((id) => [
      id,
      {
        expected: loaded.manifest.components[id].digest,
        actual: live[id].digest,
        version: live[id].version,
      },
    ]),
  ) as ReleaseManifestStatus['components']
  lastStatus = {
    present: true,
    path,
    releaseVersion: loaded.manifest.releaseVersion,
    signatureValid: true,
    match: compared.match,
    mismatches: compared.mismatches,
    components,
    checkedAt: new Date().toISOString(),
  }
  return lastStatus
}

/** Default path: shipped file next to the auth package root. */
export function defaultReleaseManifestPath(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (env.RELEASE_MANIFEST_PATH?.trim()) return env.RELEASE_MANIFEST_PATH.trim()
  // Prefer an explicit env; otherwise use the file shipped with the package when present.
  try {
    const shipped = fileURLToPath(new URL('../release-manifest.json', import.meta.url))
    readFileSync(shipped)
    return shipped
  } catch {
    return undefined
  }
}

/** Appends an audit event for the release-manifest check (match or mismatch). */
export async function recordReleaseManifestCheck(status: ReleaseManifestStatus): Promise<void> {
  await appendAudit({
    actor: { sub: 'system', iss: 'mice', email: 'system@mice', name: 'Mice' },
    via: 'system',
    method: 'SYSTEM',
    path: '/boot',
    status: status.match ? 200 : 409,
    action: 'system.release_manifest.check',
    message: status.match
      ? 'Signed release manifest verified'
      : status.present
        ? 'Signed release manifest mismatch'
        : 'Signed release manifest missing or invalid',
    detail: {
      present: status.present,
      path: status.path,
      releaseVersion: status.releaseVersion,
      signatureValid: status.signatureValid,
      match: status.match,
      mismatches: status.mismatches,
      components: status.components,
      reason: status.reason,
    },
  })
}

/**
 * Boot helper: verify the shipped manifest and always audit the result when a path
 * is configured or NODE_ENV is production (operators must see mismatch/absence).
 */
export async function verifyAndRecordReleaseManifest(
  env: Record<string, string | undefined> = process.env,
): Promise<ReleaseManifestStatus> {
  const path = defaultReleaseManifestPath(env)
  const status = await verifyReleaseManifestAt({ path })
  if (path || env.NODE_ENV === 'production') {
    await recordReleaseManifestCheck(status)
  }
  if (!status.match) {
    console.error('[mice-auth] release manifest check FAILED', status.mismatches.join('; ') || status.reason)
  }
  return status
}
