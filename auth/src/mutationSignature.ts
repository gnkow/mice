import { createHash } from 'node:crypto'
import { interpretRequest } from './authentication/session/requestInterpretation.js'
import { signatureStore, type SignatureRecord } from './authentication/signing/signatureStore.js'
import { principalKey } from './authentication/session/principal.js'

/** Client presents a prior ceremony result; BFF verifies it binds this mutation. */
export const SIGNATURE_HEADER = 'x-mice-signature-id'

/** Signature must be used within this window after signedAt (matches ceremony freshness). */
export const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000

export type MutationSignatureRejection = {
  code: 'signature_required' | 'signature_invalid'
  detail: string
}

export type CanonicalMutation = {
  v: 1
  method: string
  path: string
  action: string
  reason: string
  category: string
  body: unknown
}

/** Classifies a mutation for the signed document (proxied oxen or BFF privileged). */
export function mutationActionForPath(method: string, path: string): string {
  const p = path.split('?')[0] ?? path
  if (p.startsWith('/api/') || p.startsWith('/oxen/')) {
    return interpretRequest(method, p).action
  }
  return 'privileged_settings'
}

/**
 * Stable JSON body for hashing. Objects are key-sorted recursively; non-JSON proxy
 * payloads should pass `{ sha256: hex }` instead of raw bytes.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(sortValue)
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    out[key] = sortValue(obj[key])
  }
  return out
}

/** Decode path for stable hashing (client may send encodeURIComponent; Hono exposes decoded). */
export function normalizeMutationPath(path: string): string {
  const bare = path.split('?')[0] ?? path
  try {
    return decodeURIComponent(bare)
  } catch {
    return bare
  }
}

export function canonicalMutationContent(input: {
  method: string
  path: string
  action?: string
  reason: string
  category: string
  body?: unknown
}): CanonicalMutation {
  const path = normalizeMutationPath(input.path)
  return {
    v: 1,
    method: input.method.toUpperCase(),
    path,
    action: input.action ?? mutationActionForPath(input.method, path),
    reason: input.reason.trim(),
    category: input.category.trim(),
    body: input.body === undefined ? {} : input.body,
  }
}

export function mutationContentHash(doc: CanonicalMutation): string {
  return createHash('sha256').update(stableJson(doc), 'utf8').digest('hex')
}

export function prepareMutationDocument(input: {
  method: string
  path: string
  reason: string
  category: string
  body?: unknown
}): { content: string; hash: string; action: string; document: CanonicalMutation } {
  const document = canonicalMutationContent(input)
  const content = stableJson(document)
  return { content, hash: createHash('sha256').update(content, 'utf8').digest('hex'), action: document.action, document }
}

/**
 * Proxy bodies for the signed document: JSON objects as-is; opaque payloads as `{ sha256 }`.
 */
export function mutationBodyFromProxyPayload(body: string | ArrayBuffer | undefined): unknown {
  if (body == null || body === '') return {}
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as unknown
    } catch {
      return { sha256: createHash('sha256').update(body, 'utf8').digest('hex') }
    }
  }
  return { sha256: createHash('sha256').update(Buffer.from(body)).digest('hex') }
}

type Signer = { iss: string; sub: string }

/**
 * Pure binding checks for a loaded signature record (meaning, signer, freshness, content hash).
 * Store lookup / consume stay in `resolveMutationSignature`.
 */
export function evaluateMutationSignatureBinding(input: {
  record: SignatureRecord
  signer: Signer
  method: string
  path: string
  reason: string
  category: string
  body?: unknown
  now?: number
}): { ok: true } | { ok: false; rejection: MutationSignatureRejection } {
  if (input.record.meaning !== 'Approved') {
    return {
      ok: false,
      rejection: {
        code: 'signature_invalid',
        detail: 'Signature meaning must be Approved',
      },
    }
  }

  if (principalKey(input.record.signer) !== principalKey(input.signer)) {
    return {
      ok: false,
      rejection: {
        code: 'signature_invalid',
        detail: 'Signature signer does not match the caller',
      },
    }
  }

  const signedAt = Date.parse(input.record.signedAt)
  const now = input.now ?? Date.now()
  if (!Number.isFinite(signedAt) || now - signedAt > SIGNATURE_MAX_AGE_MS || now < signedAt - 5_000) {
    return {
      ok: false,
      rejection: {
        code: 'signature_invalid',
        detail: 'Signature has expired; sign again',
      },
    }
  }

  const expected = prepareMutationDocument({
    method: input.method,
    path: input.path,
    reason: input.reason,
    category: input.category,
    body: input.body,
  })
  if (input.record.contentHash !== expected.hash) {
    return {
      ok: false,
      rejection: {
        code: 'signature_invalid',
        detail: 'Signature does not match this mutation',
      },
    }
  }

  return { ok: true }
}

/**
 * Verifies a mutation signature and consumes it (append-only) so it cannot be reused.
 */
export async function resolveMutationSignature(input: {
  id?: string | null
  signer: Signer
  method: string
  path: string
  reason: string
  category: string
  body?: unknown
  now?: number
}): Promise<{ ok: true; signatureId: string; record: SignatureRecord } | { ok: false; rejection: MutationSignatureRejection }> {
  const id = (input.id ?? '').trim()
  if (!id) {
    return {
      ok: false,
      rejection: {
        code: 'signature_required',
        detail: 'An electronic signature is required for this change',
      },
    }
  }

  const store = await signatureStore()
  if (await store.isConsumed(id)) {
    return {
      ok: false,
      rejection: {
        code: 'signature_invalid',
        detail: 'This signature has already been used',
      },
    }
  }

  const found = await store.get(id)
  if (!found) {
    return {
      ok: false,
      rejection: {
        code: 'signature_invalid',
        detail: 'Unknown signature id',
      },
    }
  }

  const bound = evaluateMutationSignatureBinding({
    record: found.record,
    signer: input.signer,
    method: input.method,
    path: input.path,
    reason: input.reason,
    category: input.category,
    body: input.body,
    now: input.now,
  })
  if (!bound.ok) return { ok: false, rejection: bound.rejection }

  await store.consume(id)
  return { ok: true, signatureId: id, record: found.record }
}
