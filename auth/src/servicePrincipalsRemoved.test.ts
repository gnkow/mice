import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'admin@mice.local' })

import './db/testSchema.js'

const { createApp } = await import('./app.js')
const authz = await import('./authz.js')
const schema = await import('./db/schema.js')
const contract = await import('./authzContract.js')
const { decideServiceCallerAdmission, kindOf } = await import('./authentication/session/principal.js')
const {
  SERVICE_PRINCIPALS_REMOVED,
  RETIRED_SERVICE_PRINCIPAL_PATHS,
  RETIRED_SERVICE_ISSUER,
} = await import('./servicePrincipalsRemoved.js')
const { ALL_INSTANCE_PERMISSIONS } = await import('./authzTypes.js')

after(() => iso.restore())

const app = createApp()

describe('service principals removed (#05): unit', () => {
  it('documents removal at a single seam', () => {
    assert.equal(SERVICE_PRINCIPALS_REMOVED, true)
    assert.equal(RETIRED_SERVICE_ISSUER, 'urn:mice:service')
  })

  it('authz no longer exports decideServicePrincipalManage', () => {
    assert.equal('decideServicePrincipalManage' in authz, false)
  })

  it('decideInstanceAction has no serviceprincipal.admin action', async () => {
    await assert.rejects(
      () => authz.decideInstanceAction(iso.admin, 'serviceprincipal.admin' as never),
      TypeError,
    )
  })

  it('schema has no servicePrincipals table', () => {
    assert.equal('servicePrincipals' in schema, false)
  })

  it('instance catalog has no serviceprincipal.admin permission', () => {
    assert.equal(
      (ALL_INSTANCE_PERMISSIONS as readonly string[]).includes('serviceprincipal.admin'),
      false,
    )
    assert.equal(
      (contract.INSTANCE_PERMISSIONS as readonly string[]).includes('serviceprincipal.admin'),
      false,
    )
  })

  it('Principal kind is human-only; retired issuer is refused as a caller', () => {
    assert.equal(kindOf({ iss: RETIRED_SERVICE_ISSUER }), 'human')
    assert.deepEqual(decideServiceCallerAdmission({ iss: RETIRED_SERVICE_ISSUER }), {
      allow: false,
      status: 401,
      error: 'Authentication required',
    })
    assert.deepEqual(decideServiceCallerAdmission({ iss: 'https://idp.example' }), { allow: true })
  })
})

describe('service principals removed (#05): integration', () => {
  it('retired manage routes are not reachable', async () => {
    await authz.preparePrincipal(iso.admin)
    const headers = await iso.sessionHeaders(iso.admin)

    for (const path of RETIRED_SERVICE_PRINCIPAL_PATHS) {
      for (const method of ['GET', 'POST', 'DELETE'] as const) {
        const res = await app.request(path, {
          method,
          headers: {
            ...headers,
            'content-type': 'application/json',
          },
          body: method === 'GET' ? undefined : JSON.stringify({ name: 'ingest' }),
        })
        assert.equal(res.status, 404, `${method} ${path}`)
      }
    }
  })
})
