import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyMountEdits, buildRequest, parseAdminArgs, parseMount, parseNewWorkspace, parseWorkspaceMount } from './admin.mjs'
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
    const r = buildRequest('role', ['create', 'acme', 'repo', '--name', 'qa', '--base', 'read', '--permissions', 'contents_read,merge'])
    assert.equal(r.path, '/auth/namespaces/acme/custom-roles/repo')
    assert.deepEqual(r.body, { name: 'qa', base: 'read', permissions: ['contents_read', 'merge'] })
    const d = buildRequest('role', ['delete', 'acme', 'namespace', 'role1'])
    assert.equal(d.path, '/auth/namespaces/acme/custom-roles/namespace/role1')
    assert.ok(d.confirm)
    assert.throws(() => buildRequest('role', ['create', 'acme', 'repo', '--name', 'x', '--permissions', 'merge']), /--base/)
  })

  it('validates role and permission names against the contract', () => {
    assert.throws(
      () => buildRequest('instance', ['permissions', 'set', '--sub', 's', '--iss', 'i', '--permissions', 'view_audit,nope']),
      /Unknown instance permission "nope"/,
    )
    assert.throws(
      () => buildRequest('role', ['create', 'acme', 'namespace', '--name', 'x', '--permissions', 'contents_read']),
      /Unknown namespace permission "contents_read"/,
    )
    assert.throws(
      () => buildRequest('role', ['create', 'acme', 'repo', '--name', 'x', '--base', 'admin', '--permissions', 'merge']),
      /--base must be one of read, triage, write, maintain/,
    )
    assert.throws(
      () => buildRequest('role', ['create', 'acme', 'repo', '--name', 'x', '--base', 'read', '--permissions', 'view_audit']),
      /Unknown repository permission "view_audit"/,
    )
    const ok = buildRequest('role', ['create', 'acme', 'namespace', '--name', 'x', '--permissions', 'manage_members', '--base-repository-role', 'none'])
    assert.deepEqual(ok.body.permissions, ['manage_members'])
  })

  it('sessions', () => {
    const c = buildRequest('session', ['create', '--template', 't', '--cpu', '2', '--mount', 'w_abc1234567:rw', '--recording', 'true'])
    assert.deepEqual(c.body, {
      template_id: 't',
      resources: { cpu: '2' },
      mounts: [{ workspace_id: 'w_abc1234567', mount_mode: 'rw' }],
      recording: true,
    })
    assert.equal(buildRequest('session', ['stop', 's1']).path, '/auth/sessions/s1/stop')
    assert.equal(buildRequest('session', ['list', '--all']).path, '/auth/sessions?all=1')
    assert.throws(() => buildRequest('session', ['diff', 's1', 'm']))
    assert.throws(() => buildRequest('session', ['sync', 's1', 'm']))
    assert.ok(buildRequest('session', ['destroy', 's1']).confirm)
  })

  it('session/workspace requests with workspaces', () => {
    const c = buildRequest('session', ['create', '--mount', 'w_qqqqqqqqqq', '--workspace', 'w_abc1234567:rw', '--workspace', 'w_zzz9999999'])
    assert.deepEqual(c.body.mounts, [
      { workspace_id: 'w_qqqqqqqqqq' },
      { workspace_id: 'w_abc1234567', mount_mode: 'rw' },
      { workspace_id: 'w_zzz9999999' },
    ])
    assert.equal(buildRequest('session', ['list', '--workspace', 'w_abc1234567']).path, '/auth/sessions?workspace_id=w_abc1234567')
    const r = buildRequest('session', ['remount', 's1', '--workspace', 'w_abc1234567'])
    assert.deepEqual([r.method, r.path, r.body], ['POST', '/auth/sessions/s1/remount', { workspace_id: 'w_abc1234567' }])
    assert.equal(buildRequest('workspace', ['list', 'a/b']).path, '/auth/workspaces?namespace=a&repo=b')
    assert.equal(buildRequest('workspace', ['list']).path, '/auth/workspaces')
    assert.deepEqual(buildRequest('workspace', ['create', 'a/b', '--name', 'x', '--commit', 'c1']).body, {
      namespace: 'a', repo: 'b', name: 'x', source: { commit: 'c1' },
    })
    assert.deepEqual(buildRequest('workspace', ['create', 'a/b']).body.source, { branch: 'main' })
    assert.equal(buildRequest('workspace', ['changes', 'w_abc1234567']).path, '/auth/workspaces/w_abc1234567/changes')
    const d = buildRequest('workspace', ['delete', 'w_abc1234567'])
    assert.equal(d.method, 'DELETE')
    assert.ok(d.confirm)
    assert.throws(() => buildRequest('workspace', ['show', 'nope']))
  })

  it('workspace mounts', () => {
    assert.deepEqual(parseMount('w_abc1234567'), { workspace_id: 'w_abc1234567' })
    assert.deepEqual(parseMount('w_abc1234567:rw'), { workspace_id: 'w_abc1234567', mount_mode: 'rw' })
    assert.deepEqual(parseWorkspaceMount('w_abc1234567:ro'), { workspace_id: 'w_abc1234567', mount_mode: 'ro' })
    assert.throws(() => parseWorkspaceMount('w_short'), /w_<id>/)
    assert.throws(() => parseMount('w_abc1234567:x'))
  })

  it('parseMount', () => {
    assert.deepEqual(parseMount('w_abc1234567:ro'), { workspace_id: 'w_abc1234567', mount_mode: 'ro' })
    for (const bad of ['nope', 'a/b', 'a/b#abc123:ro', 'a/b@ws1', 'a/b@ws1#abc:rw']) assert.throws(() => parseMount(bad), /w_<id>/)
    assert.deepEqual(parseNewWorkspace('a/b@main'), { new_workspace: { namespace: 'a', repo: 'b', source: { branch: 'main' } } })
    assert.deepEqual(parseNewWorkspace('a/b@feat/x=my ws:ro'), {
      new_workspace: { namespace: 'a', repo: 'b', name: 'my ws', source: { branch: 'feat/x' } },
      mount_mode: 'ro',
    })
    assert.deepEqual(parseNewWorkspace('a/b#abc123=n').new_workspace, { namespace: 'a', repo: 'b', name: 'n', source: { commit: 'abc123' } })
    for (const bad of ['a/b', 'a@main', 'a/b@', 'a/b@main=', 'w_abc1234567']) assert.throws(() => parseNewWorkspace(bad), /new-workspace/)
    const c = buildRequest('session', ['create', '--new-workspace', 'a/b@main=x', '--new-workspace', 'a/c#d34d'])
    assert.equal(c.body.mounts.length, 2)
    assert.deepEqual(c.body.mounts[1].new_workspace.source, { commit: 'd34d' })
  })

  it('favorites accept stage and the deprecated workspace alias', () => {
    const ctx = {}
    for (const t of ['stage', 'workspace']) {
      const r = buildRequest('favorite', ['add', t, 'a/b!w1'], ctx)
      assert.deepEqual(r.body, { type: 'stage', id: 'a/b!w1' })
    }
    assert.equal(buildRequest('favorite', ['list', '--type', 'workspace']).path, '/auth/favorites?type=stage')
  })

  it('audit --stage-id maps to workspace_id', () => {
    for (const f of ['--stage-id', '--workspace-id']) {
      assert.match(buildRequest('audit', ['list', f, 'w1']).path, /workspace_id=w1/)
    }
  })

  it('notifications', () => {
    assert.equal(buildRequest('notifications', ['--unread']).path, '/auth/notifications?unread=1')
    assert.deepEqual(buildRequest('notifications', ['unread', 'n1']).body, { read: false })
    assert.deepEqual(buildRequest('notifications', ['preferences', 'set', '--json', '{"enabled":true}']).body, { enabled: true })
    assert.throws(() => buildRequest('notifications', ['preferences', 'set', '--json', '{']))
  })

  it('announcement', () => {
    assert.equal(buildRequest('announcement', []).path, '/auth/announcements')
    assert.equal(buildRequest('announcement', ['list', '--all']).path, '/auth/announcements?all=1')
    assert.deepEqual(buildRequest('announcement', ['create', '--title', 'Hi', '--severity', 'warning']).body, { title: 'Hi', message: undefined, severity: 'warning', expiresAt: undefined })
    assert.deepEqual(buildRequest('announcement', ['disable', 'a1']), { method: 'PATCH', path: '/auth/announcements/a1', body: { active: false } })
    assert.equal(buildRequest('announcement', ['delete', 'a1']).method, 'DELETE')
    assert.throws(() => buildRequest('announcement', ['create']), /--title/)
    assert.throws(() => buildRequest('announcement', ['create', '--title', 't', '--severity', 'x']), /--severity/)
  })

  it('favorite', () => {
    const ctx = () => ({ namespace: 'acme', repo: 'web' })
    assert.equal(buildRequest('favorite', []).path, '/auth/favorites')
    assert.equal(buildRequest('favorite', ['list', '--type', 'repo']).path, '/auth/favorites?type=repo')
    assert.deepEqual(buildRequest('favorite', ['add', 'repo'], ctx), { method: 'PUT', path: '/auth/favorites', body: { type: 'repo', id: 'acme/web' } })
    assert.deepEqual(buildRequest('favorite', ['add', 'branch', 'dev'], ctx).body, { type: 'branch', id: 'acme/web@dev' })
    assert.equal(buildRequest('favorite', ['remove', 'job', 'j1']).path, '/auth/favorites?type=job&id=j1')
    assert.throws(() => buildRequest('favorite', ['add', 'file', 'x']), /Unknown entity type/)
    assert.throws(() => buildRequest('favorite', ['list', '--type', 'x']), /--type/)
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

it('session mounts: --set replaces, --add/--remove edit the current list', () => {
  const set = buildRequest('session', ['mounts', 's1', '--set', 'w_aaaaaaaaaa:ro', '--set', 'w_bbbbbbbbbb', '--remove', 'w_bbbbbbbbbb', '--new-workspace', 'a/b@main'])
  assert.deepEqual([set.method, set.path], ['PUT', '/auth/sessions/s1/mounts'])
  assert.deepEqual(set.body.mounts, [
    { workspace_id: 'w_aaaaaaaaaa', mount_mode: 'ro' },
    { new_workspace: { namespace: 'a', repo: 'b', source: { branch: 'main' } } },
  ])
  assert.deepEqual(buildRequest('session', ['mounts', 's1', '--set', 'none']).body, { mounts: [] })
  const edit = buildRequest('session', ['mounts', 's1', '--add', 'w_cccccccccc:rw', '--remove', 'w_aaaaaaaaaa'])
  assert.equal(edit.fetchPath, '/auth/sessions/s1')
  assert.deepEqual(edit.mountsEdit.remove, ['w_aaaaaaaaaa'])
  const cur = [{ workspace_id: 'w_aaaaaaaaaa', mount_mode: 'rw' }, { workspace_id: 'w_cccccccccc', mount_mode: 'ro' }]
  assert.deepEqual(applyMountEdits(cur, edit.mountsEdit), [{ workspace_id: 'w_cccccccccc', mount_mode: 'rw' }])
  assert.throws(() => buildRequest('session', ['mounts', 's1']), /needs --set/)
  assert.throws(() => buildRequest('session', ['mounts', 's1', '--remove', 'x/y']), /--remove/)
})
