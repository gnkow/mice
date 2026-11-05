import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertIdpAssurance, idpAssuranceProblems } from './idpAssuranceGate.js'

const full = { claims_supported: ['sub', 'iss', 'auth_time', 'acr', 'amr'] }

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch
}

describe('IdP assurance startup gate', () => {
  it('accepts an IdP that advertises acr, amr and auth_time', () => {
    assert.deepEqual(idpAssuranceProblems(full), [])
  })

  for (const missing of ['acr', 'amr', 'auth_time']) {
    it(`refuses an IdP that does not advertise ${missing}`, () => {
      const problems = idpAssuranceProblems({
        claims_supported: full.claims_supported.filter((c) => c !== missing),
      })
      assert.equal(problems.length, 1)
      assert.match(problems[0], new RegExp(missing))
    })
  }

  it('refuses an IdP that advertises no claims at all', () => {
    assert.equal(idpAssuranceProblems({}).length, 3)
  })

  it('assertIdpAssurance throws with every missing claim', async () => {
    await assert.rejects(
      assertIdpAssurance('https://idp.example.com/realms/mice', jsonFetch({ claims_supported: ['sub'] })),
      /Refusing to start[\s\S]*acr[\s\S]*amr[\s\S]*auth_time/,
    )
  })

  it('assertIdpAssurance throws when discovery is unreachable', async () => {
    await assert.rejects(
      assertIdpAssurance('https://idp.example.com', jsonFetch({}, 503)),
      /discovery failed: 503/,
    )
  })

  it('assertIdpAssurance passes for a capable IdP', async () => {
    await assertIdpAssurance('https://idp.example.com/', jsonFetch(full))
  })
})
