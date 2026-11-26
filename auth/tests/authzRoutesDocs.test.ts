import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { interpretRequest } from '../src/packages/authentication/lib/session/requestInterpretation.js'
import { ACTION_MIN_ROLE } from '../src/packages/authz/lib/authzPathMap.js'
import {
  concretePathsFromPattern,
  documentedActionMinRoles,
  documentsCollaboratorSourceOfTruth,
  documentsRepoCreateAsNamespaceGate,
  markdownSection,
  markdownTableRows,
  roleToken,
} from '../src/packages/authz/lib/authzRouteDocs.js'

const doc = readFileSync(new URL('../../docs/authorization-routes.md', import.meta.url), 'utf8')

describe('authzRouteDocs helpers', () => {
  it('parses Action Minimum Roles into a map', () => {
    const documented = documentedActionMinRoles(doc)
    assert.equal(documented.merge, 'maintain')
    assert.equal(documented.push, 'write')
  })

  it('expands merge(s) and strips method prefixes', () => {
    assert.deepEqual(concretePathsFromPattern('POST /api/repos/:ns/:repo/merge(s)'), [
      '/api/repos/n/r/merge',
      '/api/repos/n/r/merges',
    ])
    assert.deepEqual(concretePathsFromPattern('PUT/PATCH /api/repos/:ns/:repo/rename'), [
      '/api/repos/n/r/rename',
    ])
    assert.equal(roleToken('admin †'), 'admin')
  })
})

describe('docs/authorization-routes.md matches the enforced tables', () => {
  it('lists every action minimum role exactly as ACTION_MIN_ROLE', () => {
    const documented = documentedActionMinRoles(doc)
    for (const [action, role] of Object.entries(ACTION_MIN_ROLE)) {
      assert.equal(documented[action], role, `action ${action}`)
    }
  })

  it('documents each classified repo-data route with the role the code enforces', () => {
    let checked = 0
    for (const [pattern, methods, ...cols] of markdownTableRows(
      markdownSection(doc, 'Route Classification Table'),
    ).filter((r) => r[0].includes('/api/repos/'))) {
      const role = cols.map(roleToken).find((c): c is string => !!c)
      if (!role) continue
      const paths = concretePathsFromPattern(pattern)
      for (const path of paths) {
        for (const method of methods.split(',').map((m) => m.trim())) {
          if (method === 'GET' || method === 'HEAD' || method === 'QUERY') continue
          if (!/^[A-Z]+$/.test(method)) continue
          assert.equal(interpretRequest(method, path).minRole, role, `${method} ${pattern} → ${path}`)
          checked++
        }
      }
    }
    assert.ok(checked >= 10, `only ${checked} route rows were checked`)
  })

  it('documents collaborator seats as the repository role source of truth', () => {
    assert.equal(
      documentsCollaboratorSourceOfTruth(doc),
      true,
      'Permission Composition must match effectiveRepoRole (collaborators only; no Namespace Owner → admin)',
    )
  })

  it('documents POST /api/repos as a namespace create gate, not collaborator write', () => {
    assert.equal(documentsRepoCreateAsNamespaceGate(doc), true)
    // interpretRequest still labels minRole write, but authorizeApiRequest does not use it.
    assert.equal(interpretRequest('POST', '/api/repos').kind, 'repo.create')
    assert.equal(interpretRequest('POST', '/api/repos').minRole, 'write')
  })

  it('documents transport authz remapping (audit commit.upload/publish → authz push)', () => {
    const complete = interpretRequest('POST', '/api/repos/n/r/commits/abc/complete')
    assert.equal(complete.action, 'commit.publish')
    assert.equal(complete.authzAction, 'push')
    assert.equal(complete.minRole, 'write')
    assert.equal(complete.recognized, true)

    const chunk = interpretRequest('POST', '/api/repos/n/r/commits/abc/chunks')
    assert.equal(chunk.action, 'commit.upload')
    assert.equal(chunk.authzAction, 'push')
    assert.equal(chunk.minRole, 'write')
    assert.equal(chunk.recognized, true)

    const section = markdownSection(doc, 'Route Classification Table')
    assert.match(section, /authzActionForPath/)
    assert.match(section, /commit\.publish/)
  })
})

describe('unclassified routes fail closed (ADR 0002)', () => {
  it('marks unknown mutating routes unrecognized so the proxy can refuse them', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = interpretRequest(method, '/api/repos/n/r/mystery')
      assert.equal(r.recognized, false, method)
      assert.equal(r.action, 'unclassified', method)
    }
    assert.equal(interpretRequest('GET', '/api/mystery').kind, 'other')
  })
})

describe('pinned oxen-server route contract', () => {
  it('classifies every pinned oxen route at the documented minimum role', () => {
    const pin = JSON.parse(
      readFileSync(new URL('./fixtures/oxen-server-routes.pinned.json', import.meta.url), 'utf8'),
    ) as {
      oxenImage: string
      routes: Array<{ method: string; path: string; minRole: string }>
    }
    assert.ok(pin.oxenImage, 'pin must name the oxen image/version')
    assert.ok(pin.routes.length >= 15, 'pin must cover the documented oxen surface')
    for (const route of pin.routes) {
      const got = interpretRequest(route.method, route.path)
      assert.equal(
        got.minRole,
        route.minRole,
        `${route.method} ${route.path} → ${got.authzAction}/${got.minRole}`,
      )
      if (!['GET', 'HEAD'].includes(route.method.toUpperCase())) {
        assert.notEqual(got.kind, 'other', `${route.method} ${route.path} must not be unscoped other`)
      }
    }
  })
})
