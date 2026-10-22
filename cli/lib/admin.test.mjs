import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildRequest, parseAdminArgs, parseMount } from './admin.mjs'
import { buildSearchQuery, parseMetaArgs } from './meta.mjs'

const ctx = () => ({ namespace: 'acme', repo: 'data' })

describe('parseAdminArgs', () => {
  it('keeps boolean flags from swallowing positionals', () => {
    const p = parseAdminArgs(['--yes', 'acme', '--file', 'a', '--file=b'])
    assert.deepEqual(p._, ['acme'])
    assert.equal(p.flags.yes, true)
    assert.deepEqual(p.flags.file, ['a', 'b'])
  })
})

describe('buildRequest', () => {
  it('namespaces', () => {
    assert.deepEqual(buildRequest('namespace', ['list']), { method: 'GET', path: '/auth/namespaces' })
    assert.deepEqual(
      buildRequest('namespace', ['create', 'acme', '--base-permission', 'read', '--members-create-repos', 'false']).body,
      { name: 'acme', basePermission: 'read', membersCanCreateRepos: false },
    )
    const del = buildRequest('namespace', ['delete', 'acme', '--keep-repos'])
    assert.equal(del.method, 'DELETE')
    assert.deepEqual(del.body, { deleteRepositories: false })
    assert.ok(del.confirm)
  })

  it('members and collaborators accept users and groups', () => {
    assert.deepEqual(
      buildRequest('namespace', ['member', 'set', 'acme', '--sub', 's', '--iss', 'i', '--role', 'owner']).body,
      { kind: 'user', sub: 's', iss: 'i', role: 'owner' },
    )
    const c = buildRequest('collaborator', ['set', '--group', 'ml', '--role', 'write'], ctx)
    assert.equal(c.path, '/auth/namespaces/acme/repos/data/collaborators')
    assert.deepEqual(c.body, { kind: 'group', group: 'ml', role: 'write' })
    assert.throws(() => buildRequest('collaborator', ['remove', 'a/b', '--sub', 's']), /--iss/)
  })

  it('instance admin and permissions', () => {
    assert.deepEqual(buildRequest('instance', ['enforce', 'on']).body, { enforce: true })
    assert.throws(() => buildRequest('instance', ['enforce', 'maybe']))
    assert.deepEqual(buildRequest('instance', ['admin', 'remove', '--sub', 's', '--iss', 'i']), {
      method: 'DELETE',
      path: '/auth/instance/admins',
      body: { sub: 's', iss: 'i' },
    })
    assert.deepEqual(
      buildRequest('instance', ['permissions', 'set', '--sub', 's', '--iss', 'i', '--permissions', 'view_audit,view_lineage']).body.permissions,
      ['view_audit', 'view_lineage'],
    )
  })

  it('access requests', () => {
    assert.deepEqual(buildRequest('access-request', ['approve', 'r1', '--namespace', 'acme', '--role', 'member']).body, {
      action: 'approve',
      namespace: 'acme',
      role: 'member',
    })
    assert.deepEqual(buildRequest('access-request', ['deny', 'r1']).body, { action: 'deny' })
  })

  it('audit filters map to the API query names', () => {
    const r = buildRequest('audit', ['list', '--job-id', 'j1', '--via', 'pat', '--limit', '5'])
    const u = new URL(r.path, 'http://x')
    assert.equal(u.pathname, '/auth/audit')
    assert.equal(u.searchParams.get('job_id'), 'j1')
    assert.equal(u.searchParams.get('via'), 'pat')
    assert.equal(u.searchParams.get('limit'), '5')
    const csv = buildRequest('audit', ['export', '--out', 'a.csv'])
    assert.equal(csv.text, true)
    assert.equal(csv.out, 'a.csv')
    assert.throws(() => buildRequest('audit', ['list', '--via', 'x']))
  })

  it('lineage uses clone context', () => {
    const q = new URL(buildRequest('lineage', ['query', '--path', 'a.csv', '--direction', 'both'], ctx).path, 'http://x')
    assert.equal(q.searchParams.get('namespace'), 'acme')
    assert.equal(q.searchParams.get('repo'), 'data')
    assert.equal(q.searchParams.get('path'), 'a.csv')
    assert.deepEqual(buildRequest('lineage', ['rebuild', '--path', 'a.csv'], ctx).body, {
      namespace: 'acme',
      repo: 'data',
      path: 'a.csv',
      branch: undefined,
    })
  })

  it('custom roles', () => {
    const r = buildRequest('role', ['create', 'acme', 'repo', '--name', 'qa', '--base', 'read', '--permissions', 'a,b'])
    assert.equal(r.path, '/auth/namespaces/acme/custom-roles/repo')
    assert.deepEqual(r.body, { name: 'qa', base: 'read', permissions: ['a', 'b'] })
    const d = buildRequest('role', ['delete', 'acme', 'namespace', 'role1'])
    assert.equal(d.path, '/auth/namespaces/acme/custom-roles/namespace/role1')
    assert.ok(d.confirm)
    assert.throws(() => buildRequest('role', ['create', 'acme', 'repo', '--name', 'x', '--permissions', 'a']), /--base/)
  })

  it('sessions', () => {
    const c = buildRequest('session', ['create', '--template', 't', '--cpu', '2', '--mount', 'acme/data@ws1:rw', '--recording', 'true'])
    assert.deepEqual(c.body, {
      template_id: 't',
      resources: { cpu: '2' },
      mounts: [{ namespace: 'acme', repo: 'data', workspace_id: 'ws1', mount_mode: 'rw' }],
      recording: true,
    })
    assert.equal(buildRequest('session', ['stop', 's1']).path, '/auth/sessions/s1/stop')
    assert.equal(buildRequest('session', ['list', '--all']).path, '/auth/sessions?all=1')
    assert.deepEqual(buildRequest('session', ['sync', 's1', 'm', '--file', 'a,b']).body, { files: ['a', 'b'] })
    assert.equal(buildRequest('session', ['diff', 's1', 'm']).path, '/auth/sessions/s1/mounts/m/diff')
    assert.ok(buildRequest('session', ['destroy', 's1']).confirm)
  })

  it('parseMount', () => {
    assert.deepEqual(parseMount('a/b#abc123:ro'), { namespace: 'a', repo: 'b', pin_commit: 'abc123', mount_mode: 'ro' })
    assert.throws(() => parseMount('nope'))
  })

  it('notifications', () => {
    assert.equal(buildRequest('notifications', ['--unread']).path, '/auth/notifications?unread=1')
    assert.deepEqual(buildRequest('notifications', ['unread', 'n1']).body, { read: false })
    assert.deepEqual(buildRequest('notifications', ['preferences', 'set', '--json', '{"enabled":true}']).body, { enabled: true })
    assert.throws(() => buildRequest('notifications', ['preferences', 'set', '--json', '{']))
  })

  it('rejects unknown subcommands', () => {
    assert.throws(() => buildRequest('namespace', ['bogus']), /Unknown/)
  })
})

describe('meta search query', () => {
  it('builds filters', () => {
    const p = parseMetaArgs(['hello', 'world', '--type', 'repo,file', '--tag', 'a', '--label', 'Env=prod', '--namespace', 'acme', '--limit', '10'])
    const u = new URL(buildSearchQuery(p), 'http://x')
    assert.equal(u.searchParams.get('q'), 'hello world')
    assert.deepEqual(u.searchParams.getAll('type'), ['repo', 'file'])
    assert.deepEqual(u.searchParams.getAll('tag'), ['a'])
    assert.equal(u.searchParams.get('label.env'), 'prod')
    assert.equal(u.searchParams.get('namespace'), 'acme')
  })
})
