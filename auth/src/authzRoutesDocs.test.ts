import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { interpretRequest } from './authentication/session/requestInterpretation.js'
import { ACTION_MIN_ROLE } from './authzPathMap.js'

const doc = readFileSync(new URL('../../docs/authorization-routes.md', import.meta.url), 'utf8')

const section = (heading: string) => {
  const start = doc.indexOf(`## ${heading}`)
  assert.ok(start >= 0, `docs missing "${heading}"`)
  const rest = doc.slice(start + 1)
  const next = rest.search(/\n## /)
  return next < 0 ? rest : rest.slice(0, next)
}

const rows = (text: string) =>
  text
    .split('\n')
    .filter((l) => l.startsWith('|') && !/^\|[-| ]+\|$/.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim().replaceAll('`', '')))

const ROLES = ['read', 'triage', 'write', 'maintain', 'admin']

describe('docs/authorization-routes.md matches the enforced tables', () => {
  it('lists every action minimum role exactly as ACTION_MIN_ROLE', () => {
    const documented = Object.fromEntries(rows(section('Action Minimum Roles')).slice(1).map(([a, r]) => [a, r]))
    for (const [action, role] of Object.entries(ACTION_MIN_ROLE)) {
      assert.equal(documented[action], role, `action ${action}`)
    }
  })

  it('documents each classified route with the role the code enforces', () => {
    let checked = 0
    for (const [pattern, methods, ...cols] of rows(section('Route Classification Table')).filter((r) => r[0].includes('/api/repos/'))) {
      const role = cols.find((c) => ROLES.includes(c))
      if (!role) continue
      const path = pattern.replace(/^\S+\s/, '').replaceAll(':ns', 'n').replaceAll(':repo', 'r').replaceAll(':branch', 'b').replaceAll(':id', 'i').replaceAll('**', 'x/y')
      for (const method of methods.split(',').map((m) => m.trim())) {
        if (method === 'GET' || method === 'HEAD' || method === 'QUERY') continue
        assert.equal(interpretRequest(method, path).minRole, role, `${method} ${pattern}`)
        checked++
      }
    }
    assert.ok(checked >= 10, `only ${checked} route rows were checked`)
  })
})

describe('unclassified routes fail closed (ADR 0002)', () => {
  it('requires repo admin for unknown mutating routes and refuses unscoped ones', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal(interpretRequest(method, '/api/repos/n/r/mystery').minRole, 'admin', method)
    }
    assert.equal(interpretRequest('GET', '/api/mystery').kind, 'other')
  })
})