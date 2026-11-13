/**
 * Package-seam integration for Ticket 50.
 * Boot calls assertIdpAssurance only in production; this exercises that gate
 * through the authentication package export with a fake discovery fetch.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

const { assertIdpAssurance, assessIdpAssurance } = await import('../index.js')

const full = { claims_supported: ['sub', 'iss', 'auth_time', 'acr', 'amr'] }

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch
}

/** Mirrors boot.ts: IdP assurance runs only when NODE_ENV is production. */
async function bootIdpAssuranceGate(
  nodeEnv: string | undefined,
  issuer: string,
  doFetch: typeof fetch,
): Promise<void> {
  if (nodeEnv === 'production') {
    await assertIdpAssurance(issuer, doFetch)
  }
}

describe('Ticket 50 — IdP assurance package / boot gate', () => {
  it('assertIdpAssurance refuses discovery that omits acr/amr/auth_time', async () => {
    await assert.rejects(
      assertIdpAssurance(
        'https://idp.example.com/realms/mice',
        jsonFetch({ claims_supported: ['sub', 'iss'] }),
      ),
      /Refusing to start[\s\S]*acr[\s\S]*amr[\s\S]*auth_time/,
    )
  })

  it('assessIdpAssurance reports discovery failure through the package export', async () => {
    const result = await assessIdpAssurance('https://idp.example.com', jsonFetch({}, 502))
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.match(result.problems[0]!, /discovery failed: 502/)
  })

  it('boot gate refuses a weak IdP in production and skips outside production', async () => {
    const weak = jsonFetch({ claims_supported: ['sub'] })
    await assert.rejects(
      bootIdpAssuranceGate('production', 'https://idp.example.com', weak),
      /Refusing to start/,
    )
    await bootIdpAssuranceGate('development', 'https://idp.example.com', weak)
    await bootIdpAssuranceGate(undefined, 'https://idp.example.com', weak)
  })

  it('boot gate accepts a capable IdP in production', async () => {
    await bootIdpAssuranceGate('production', 'https://idp.example.com/', jsonFetch(full))
  })
})
