import type { APIRequestContext } from '@playwright/test'

const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'

/**
 * Headers for a regulated BFF mutation in e2e (AUTH_DEV_MODE mint).
 * Mirrors auth `regulatedMutationHeaders` without a live IdP step-up.
 */
export async function regulatedMutationHeaders(
  request: APIRequestContext,
  mutation: {
    method: string
    path: string
    body?: unknown
    reason?: string
    category?: string
  },
): Promise<Record<string, string>> {
  const reason = mutation.reason ?? 'E2E regulated mutation for automated coverage'
  const category = mutation.category ?? 'revocation'
  const res = await request.post(`${AUTH_URL}/auth/dev/mutation-signature`, {
    data: {
      method: mutation.method,
      path: mutation.path,
      reason,
      category,
      body: mutation.body ?? {},
    },
  })
  if (!res.ok()) {
    throw new Error(`dev mutation-signature failed ${res.status()}: ${await res.text()}`)
  }
  const body = (await res.json()) as { signatureId: string }
  return {
    'content-type': 'application/json',
    'x-mice-reason': reason,
    'x-mice-reason-category': category,
    'x-mice-signature-id': body.signatureId,
  }
}
