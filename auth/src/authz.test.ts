import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import './db/testSchema.js'

const dataDir = mkdtempSync(join(tmpdir(), 'mice-authz-'))

process.env.AUTH_DATA_DIR = dataDir
process.env.AUTHZ_ENFORCE = 'true'
process.env.AUTHZ_DEV_GRANT_ALL = 'false'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.AUTHZ_GROUP_BOOTSTRAP = JSON.stringify({
  'alice@example.com': {
    namespace: 'from-group',
    role: 'member',
    createNamespace: true,
    basePermission: 'read',
  },
})
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'

const {
  authorizeApiRequest,
  authorizeAuditQuery,
  authorizeCliDeviceApprove,
  authorizeLineageQuery,
  authorizeLineageRebuild,
  authorizeRepoAction,
  authorizeManageOwnTokens,
  canManageRepoCollaborators,
  canSkipPendingGate,
  effectiveRepoRole,
  hasRepoPermission,
  isPendingUser,
  preparePrincipal,
} = await import('./authz.js')
const { isCustomRepoRoleAssigned, removeRepoCollaborator, setRepoCollaborator, setRepoGroupCollaborator } = await import('./authzCollaboratorStore.js')
const { addInstanceAdmin, hasInstancePermission, isAuthzEnforce, isInstanceAdmin, setAuthzEnforce, setInstancePermissions, removeInstanceAdmin, listInstanceAdmins, setTrainingCompletedSelf, hasCompletedTraining, writeInstancePermissions } = await import('./authzInstanceStore.js')
const { hasNamespaceCapability, isCustomNamespaceRoleAssigned, setNamespaceMember, setNamespaceGroupMember, removeNamespaceMember, removeNamespaceGroupMember, listNamespaceMembers } = await import('./authzMembershipStore.js')
const { createNamespaceAuthz, deleteNamespaceAuthz, updateNamespaceSettings, getNamespace } = await import('./authzNamespaceStore.js')
const {
  canReviewAccessRequests,
  submitAccessRequest,
  resolveAccessRequest,
} = await import('./accessRequests.js')
const { createPat, resolvePat } = await import('./authentication/index.js')
const { OXEN_PATH_ROLE_MAP, minRoleForAction } = await import('./authzPathMap.js')
const { classifyPath, interpretRequest } = await import('./authentication/index.js')
const requiredRepoRoleForRequest = (method: string, path: string) => interpretRequest(method, path).minRole
const { env } = await import('./env.js')
const {
  createCustomNamespaceRole,
  createCustomRepoRole,
  listCustomNamespaceRoles,
  deleteCustomNamespaceRole,
  deleteCustomRepoRole,
  finePermissionForAction,
  updateCustomNamespaceRole,
  updateCustomRepoRole,
} = await import('./customRoles.js')

function mkUser(id: string, groups?: string[]) {
  return {
    sub: id,
    iss: 'test',
    email: `${id}@example.com`,
    name: id,
    ...(groups ? { groups } : {}),
  }
}

const admin = {
  sub: 'admin',
  iss: 'test',
  email: 'admin@mice.local',
  emailVerified: true,
  name: 'Admin',
}
const alice = {
  sub: 'alice',
  iss: 'test',
  email: 'alice@example.com',
  name: 'Alice',
}
const bob = {
  sub: 'bob',
  iss: 'test',
  email: 'bob@example.com',
  name: 'Bob',
}

before(async () => {
  await setAuthzEnforce(true)
  await preparePrincipal(admin)
})

after(async () => {
  rmSync(dataDir, { recursive: true, force: true })
})

await describe('TC-AUTHO matrix', async () => {
  await it('TC-AUTHO-01: zero grants → pending + /api denied', async () => {
    const stranger = {
      sub: 'stranger',
      iss: 'test',
      email: 'stranger@example.com',
      name: 'Stranger',
    }
    assert.equal(await isPendingUser(stranger), true)
    const d = await authorizeApiRequest({
      user: stranger,
      via: 'session',
      method: 'GET',
      pathname: '/api/repos/ns/repo',
    })
    assert.equal(d.allow, false)
  })

  await it('TC-AUTHO-02: instance admin can create namespace', async () => {
    const r = await createNamespaceAuthz(admin, 'tc02-ns', 'none', true)
    assert.equal(r.ok, true)
  })

  await it('TC-AUTHO-03: member base none cannot read', async () => {
    const ns = 'tc03'
    await createNamespaceAuthz(admin, ns, 'none', true)
    await setNamespaceMember(ns, alice, 'member')
    assert.equal((await hasRepoPermission(alice, ns, 'r', 'read')).ok, false)
  })

  await it('TC-AUTHO-04: member base read can read not write', async () => {
    const ns = 'tc04'
    await createNamespaceAuthz(admin, ns, 'read', true)
    await setNamespaceMember(ns, alice, 'member')
    assert.equal((await hasRepoPermission(alice, ns, 'r', 'read')).ok, true)
    assert.equal((await hasRepoPermission(alice, ns, 'r', 'write')).ok, false)
  })

  await it('TC-AUTHO-05: Owner implicit admin', async () => {
    const ns = 'tc05'
    await createNamespaceAuthz(admin, ns, 'none', true)
    assert.equal(await effectiveRepoRole(admin, ns, 'any'), 'admin')
  })

  await it('TC-AUTHO-06: outside collaborator write only that repo', async () => {
    const ns = 'tc06'
    await createNamespaceAuthz(admin, ns, 'none', true)
    await setRepoCollaborator(ns, 'only', bob, 'write')
    assert.equal(await isPendingUser(bob), false)
    assert.equal((await hasRepoPermission(bob, ns, 'only', 'write')).ok, true)
    assert.equal((await hasRepoPermission(bob, ns, 'other', 'read')).ok, false)
  })

  await it('TC-AUTHO-07: additive base read + direct write', async () => {
    const ns = 'tc07'
    await createNamespaceAuthz(admin, ns, 'read', true)
    await setNamespaceMember(ns, alice, 'member')
    await setRepoCollaborator(ns, 'repo', alice, 'write')
    assert.equal(await effectiveRepoRole(alice, ns, 'repo'), 'write')
  })

  await it('TC-AUTHO-08: insufficient role → 403 decision', async () => {
    const ns = 'tc08'
    await createNamespaceAuthz(admin, ns, 'read', true)
    await setNamespaceMember(ns, alice, 'member')
    const d = await authorizeApiRequest({
      user: alice,
      via: 'session',
      method: 'PUT',
      pathname: `/api/repos/${ns}/repo/file/main/a.txt`,
    })
    assert.equal(d.allow, false)
  })

  await it('TC-AUTHO-09: cannot remove last Owner', async () => {
    const ns = 'tc09'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const r = await removeNamespaceMember(ns, admin)
    assert.equal(r.ok, false)
  })

  await it('TC-AUTHO-10: cannot remove last instance admin', async () => {
    const admins = await listInstanceAdmins()
    assert.ok(admins.length >= 1)
    // Ensure only one admin then try remove
    for (const a of admins) {
      if (a.sub !== admin.sub) await removeInstanceAdmin(admin, a)
    }
    const r = await removeInstanceAdmin(admin, admin)
    assert.equal(r.ok, false)
  })

  await it('TC-AUTHO-11: site admin bypass when no grant', async () => {
    const ns = 'tc11'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const admin2 = {
      sub: 'admin2',
      iss: 'test',
      email: 'admin2@mice.local',
      name: 'Admin2',
    }
    await addInstanceAdmin(admin, admin2)
    const d = await authorizeApiRequest({
      user: admin2,
      via: 'session',
      method: 'GET',
      pathname: `/api/repos/${ns}/secret`,
    })
    assert.equal(d.allow, true)
    assert.equal(d.siteAdminBypass, true)
  })

  await it('TC-AUTHO-12: Owner audit scoped; view_audit instance-wide', async () => {
    const ns = 'tc12'
    await createNamespaceAuthz(admin, ns, 'none', true)
    await setNamespaceMember(ns, alice, 'owner')
    // demote admin? keep alice as second owner
    const gate = await authorizeAuditQuery(alice, undefined)
    assert.equal(gate.allow, true)
    assert.ok(gate.forceNamespace === ns || gate.ownedOnly?.includes(ns))

    await writeInstancePermissions(bob, ['view_audit'])
    const g2 = await authorizeAuditQuery(bob, undefined)
    assert.equal(g2.allow, true)
    assert.equal(g2.forceNamespace, undefined)
  })

  await it('TC-AUTHO-13: PAT scopes cannot exceed / widen access', async () => {
    const ns = 'tc13'
    await createNamespaceAuthz(admin, ns, 'write', true)
    await setNamespaceMember(ns, alice, 'member')
    const { token } = await createPat(alice, 'scoped', [
      { namespace: ns, repo: 'r1', maxRole: 'read' },
    ])
    const patUser = await resolvePat(token)
    assert.ok(patUser)
    assert.equal((await hasRepoPermission(patUser!, ns, 'r1', 'read')).ok, true)
    assert.equal((await hasRepoPermission(patUser!, ns, 'r1', 'write')).ok, false)
  })

  await it('TC-AUTHO-14: membersCanCreateRepos off denies members', async () => {
    const ns = 'tc14'
    await createNamespaceAuthz(admin, ns, 'read', true)
    await updateNamespaceSettings(ns, { membersCanCreateRepos: false })
    await setNamespaceMember(ns, alice, 'member')
    const d = await authorizeApiRequest({
      user: alice,
      via: 'session',
      method: 'POST',
      pathname: '/api/repos',
      createNamespace: ns,
      createRepo: 'new',
    })
    assert.equal(d.allow, false)
  })
})

await describe('Phase 2–3 extras', async () => {
  await it('access request submit + approve', async () => {
    const req = await submitAccessRequest(bob, 'please')
    assert.equal(req.status, 'pending')
    const resolved = await resolveAccessRequest(admin, req.id, 'approve', {
      permission: 'create_namespace',
    })
    assert.equal(resolved.ok, true)
  })

  await it('group bootstrap creates namespace membership', async () => {
    await preparePrincipal(alice)
    // alice email maps to from-group
    assert.equal(await isPendingUser(alice), false)
  })

  await it('IdP group member gets base permission', async () => {
    const ns = 'tc-group-member'
    await createNamespaceAuthz(admin, ns, 'read', true)
    await setNamespaceGroupMember(ns, 'engineering', 'member')
    const carol = {
      sub: 'carol',
      iss: 'test',
      email: 'carol@example.com',
      name: 'Carol',
      groups: ['Engineering'],
    }
    assert.equal(await isPendingUser(carol), false)
    assert.equal((await hasRepoPermission(carol, ns, 'r', 'read')).ok, true)
    assert.equal((await hasRepoPermission(carol, ns, 'r', 'write')).ok, false)
  })

  await it('IdP group collaborator grants repo role', async () => {
    const ns = 'tc-group-collab'
    await createNamespaceAuthz(admin, ns, 'none', true)
    await setRepoGroupCollaborator(ns, 'data', 'contractors', 'write')
    const dave = {
      sub: 'dave',
      iss: 'test',
      email: 'dave@example.com',
      name: 'Dave',
      groups: ['contractors'],
    }
    assert.equal((await hasRepoPermission(dave, ns, 'data', 'write')).ok, true)
    assert.equal((await hasRepoPermission(dave, ns, 'other', 'read')).ok, false)
  })

  await it('additive user + group grants take max role', async () => {
    const ns = 'tc-group-add'
    await createNamespaceAuthz(admin, ns, 'read', true)
    await setNamespaceMember(ns, alice, 'member')
    await setRepoGroupCollaborator(ns, 'repo', 'leads', 'maintain')
    const withGroup = { ...alice, groups: ['leads'] }
    assert.equal(await effectiveRepoRole(withGroup, ns, 'repo'), 'maintain')
  })

  await it('leaving IdP group loses group-derived access', async () => {
    const ns = 'tc-group-leave'
    await createNamespaceAuthz(admin, ns, 'read', true)
    await setNamespaceGroupMember(ns, 'temp', 'member')
    const eve = {
      sub: 'eve',
      iss: 'test',
      email: 'eve@example.com',
      name: 'Eve',
      groups: ['temp'],
    }
    assert.equal((await hasRepoPermission(eve, ns, 'r', 'read')).ok, true)
    const left = { ...eve, groups: [] }
    assert.equal((await hasRepoPermission(left, ns, 'r', 'read')).ok, false)
    assert.equal(await isPendingUser(left), true)
  })

  await it('cannot remove last Owner when only group Owner remains', async () => {
    const ns = 'tc-group-owner'
    await createNamespaceAuthz(admin, ns, 'none', true)
    await setNamespaceGroupMember(ns, 'owners', 'owner')
    // Remove user Owner — group Owner remains
    const r = await removeNamespaceMember(ns, admin)
    assert.equal(r.ok, true)
    const r2 = await removeNamespaceGroupMember(ns, 'owners')
    assert.equal(r2.ok, false)
    const listed = await listNamespaceMembers(ns)
    assert.ok(listed.some((m) => m.kind === 'group' && m.group === 'owners'))
  })

  await it('PAT snapshots groups at mint', async () => {
    const ns = 'tc-pat-groups'
    await createNamespaceAuthz(admin, ns, 'read', true)
    await setNamespaceGroupMember(ns, 'pat-team', 'member')
    const frank = {
      sub: 'frank',
      iss: 'test',
      email: 'frank@example.com',
      name: 'Frank',
      groups: ['pat-team'],
    }
    const { token } = await createPat(frank, 'with-groups')
    const patUser = await resolvePat(token)
    assert.ok(patUser)
    assert.deepEqual(patUser!.groups, ['pat-team'])
    assert.equal((await hasRepoPermission(patUser!, ns, 'r', 'read')).ok, true)
  })

  await it('training gate blocks until completed', async () => {
    const trainee = mkUser('trainee-gate')
    const ns = 'tc-train'
    await createNamespaceAuthz(admin, ns, 'read', true)
    await setNamespaceMember(ns, trainee, 'member')
    await setTrainingCompletedSelf(trainee, false)

    const prev = env.authzRequireTraining
    env.authzRequireTraining = true
    try {
      const denied = await authorizeApiRequest({
        user: trainee,
        via: 'session',
        method: 'GET',
        pathname: `/api/repos/${ns}/r`,
      })
      assert.equal(denied.allow, false)
      assert.match(denied.reason ?? '', /Training/i)

      await setTrainingCompletedSelf(trainee, true)
      const allowed = await authorizeApiRequest({
        user: trainee,
        via: 'session',
        method: 'GET',
        pathname: `/api/repos/${ns}/r`,
      })
      assert.equal(allowed.allow, true)

      // Instance admins skip the training gate
      const adminOk = await authorizeApiRequest({
        user: admin,
        via: 'session',
        method: 'GET',
        pathname: `/api/repos/${ns}/r`,
      })
      assert.equal(adminOk.allow, true)
    } finally {
      env.authzRequireTraining = prev
      await setTrainingCompletedSelf(trainee, false)
    }
  })

  await it('path role map is non-empty and aligns with interpretRequest', () => {
    assert.ok(OXEN_PATH_ROLE_MAP.length >= 8)
    assert.equal(requiredRepoRoleForRequest('GET', '/api/repos/n/r'), 'read')
    assert.equal(
      requiredRepoRoleForRequest('PUT', '/api/repos/n/r/file/main/a'),
      'write',
    )
    assert.equal(
      requiredRepoRoleForRequest('POST', '/api/repos/n/r/merge'),
      'maintain',
    )
    assert.equal(
      requiredRepoRoleForRequest('DELETE', '/api/repos/n/r'),
      'admin',
    )
    assert.equal(
      requiredRepoRoleForRequest('POST', '/api/repos/n/r/mystery'),
      'admin',
    )
  })

  await it('Write collaborator can push; Read collaborator cannot; merge stays Maintain', async () => {
    const ns = 'tc-push'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const writer = mkUser('push-writer')
    const reader = mkUser('push-reader')
    await setRepoCollaborator(ns, 'r', writer, 'write')
    await setRepoCollaborator(ns, 'r', reader, 'read')
    const pushRoutes: Array<[string, string]> = [
      ['POST', `/api/repos/${ns}/r/commits/upload`],
      ['POST', `/api/repos/${ns}/r/commits/abc`],
      ['POST', `/api/repos/${ns}/r/commits/abc/complete`],
      ['PUT', `/api/repos/${ns}/r/versions/v1/chunks`],
    ]
    for (const [method, pathname] of pushRoutes) {
      const w = await authorizeApiRequest({ user: writer, via: 'session', method, pathname })
      assert.equal(w.allow, true, `writer ${method} ${pathname}`)
      const r = await authorizeApiRequest({ user: reader, via: 'session', method, pathname })
      assert.equal(r.allow, false, `reader ${method} ${pathname}`)
    }
    const versionQuery = await authorizeApiRequest({
      user: reader,
      via: 'session',
      method: 'QUERY',
      pathname: `/api/repos/${ns}/r/versions`,
    })
    assert.equal(versionQuery.allow, true)
    const merge = await authorizeApiRequest({
      user: writer,
      via: 'session',
      method: 'POST',
      pathname: `/api/repos/${ns}/r/merge`,
    })
    assert.equal(merge.allow, false)
  })

  await it('denies unrecognised unscoped GET/HEAD paths for a member', async () => {
    const ns = 'tc-default-deny'
    await createNamespaceAuthz(admin, ns, 'read', true)
    const u = mkUser('default-deny-user')
    await setNamespaceMember(ns, u, 'member')
    for (const method of ['GET', 'HEAD']) {
      for (const pathname of [
        '/api/mystery',
        '/api/Repos/ns/r/file/main/a',
        '/api/repos',
        '/api/admin/users',
        '/other',
      ]) {
        const d = await authorizeApiRequest({ user: u, via: 'session', method, pathname })
        assert.equal(d.allow, false, `${method} ${pathname}`)
      }
    }
  })

  await it('still allows the allowlisted unscoped GET routes for a member', async () => {
    const ns = 'tc-allowlist'
    await createNamespaceAuthz(admin, ns, 'read', true)
    const u = mkUser('allowlist-user')
    await setNamespaceMember(ns, u, 'member')
    for (const pathname of [
      '/api/version',
      '/api/health',
      '/api/oxen_version',
      '/api/namespaces',
      `/api/namespaces/${ns}`,
      `/api/repos/${ns}`,
    ]) {
      const d = await authorizeApiRequest({ user: u, via: 'session', method: 'GET', pathname })
      assert.equal(d.allow, true, pathname)
    }
  })

  await it('every action classifyPath emits for a repo route is in the table or falls to admin', () => {
    const samples: Array<[string, string]> = [
      ['PUT', '/api/repos/n/r/file/main/a'],
      ['DELETE', '/api/repos/n/r/file/main/a'],
      ['POST', '/api/repos/n/r/branches'],
      ['DELETE', '/api/repos/n/r/branches/b'],
      ['PUT', '/api/repos/n/r/branches/b'],
      ['POST', '/api/repos/n/r/merge'],
      ['POST', '/api/repos/n/r/workspaces'],
      ['DELETE', '/api/repos/n/r'],
      ['PATCH', '/api/repos/n/r'],
      ['POST', '/api/repos'],
    ]
    for (const [method, path] of samples) {
      const { action } = classifyPath(method, path)
      assert.ok(minRoleForAction(action), `${method} ${path} -> ${action} missing from table`)
      assert.equal(requiredRepoRoleForRequest(method, path), minRoleForAction(action))
    }
    for (const row of OXEN_PATH_ROLE_MAP) {
      assert.ok(['read', 'triage', 'write', 'maintain', 'admin'].includes(row.minRole))
    }
  })

  await it('deleteNamespaceAuthz removes settings and members', async () => {
    const ns = 'to-delete'
    await createNamespaceAuthz(admin, ns, 'none', true)
    await setNamespaceMember(ns, alice, 'member')
    assert.ok(await getNamespace(ns))
    const r = await deleteNamespaceAuthz(ns)
    assert.equal(r.ok, true)
    assert.equal(await getNamespace(ns), null)
  })

  await it('custom repo role Write+merge allows merge without Maintain', async () => {
    const { createCustomRepoRole } = await import('./customRoles.js')
    const ns = 'tc-custom-repo'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const created = await createCustomRepoRole(ns, {
      name: 'Merger',
      base: 'write',
      permissions: ['merge'],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    await setRepoCollaborator(ns, 'r1', bob, created.role.id)
    assert.equal((await hasRepoPermission(bob, ns, 'r1', 'write')).ok, true)
    assert.equal((await hasRepoPermission(bob, ns, 'r1', 'maintain')).ok, false)
    assert.equal(
      (await hasRepoPermission(bob, ns, 'r1', 'maintain', {
        method: 'POST',
        action: 'merge',
      })).ok,
      true,
    )
    assert.equal(
      (await hasRepoPermission(bob, ns, 'r1', 'admin', {
        method: 'DELETE',
        action: 'repo.delete',
      })).ok,
      false,
    )
  })

  await it('custom namespace role grants view_audit capability', async () => {
    const ns = 'tc-custom-ns'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const created = await createCustomNamespaceRole(ns, {
      name: 'Auditor',
      permissions: ['view_audit'],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    await setNamespaceMember(ns, bob, created.role.id)
    assert.equal(await hasNamespaceCapability(ns, bob, 'view_audit'), true)
    assert.equal(await hasNamespaceCapability(ns, bob, 'manage_members'), false)
    const gate = await authorizeAuditQuery(bob, ns)
    assert.equal(gate.allow, true)
  })
})

await describe('enforcement gates', async () => {
  await it('enforce off allows all /api decisions', async () => {
    const stranger = mkUser('enforce-off-user')
    const prev = env.authzEnforce
    env.authzEnforce = 'false'
    try {
      assert.equal(await isAuthzEnforce(), false)
      assert.equal(await isPendingUser(stranger), false)
      const d = await authorizeApiRequest({
        user: stranger,
        via: 'session',
        method: 'PUT',
        pathname: '/api/repos/ns/repo/file/main/a.txt',
      })
      assert.equal(d.allow, true)
      const audit = await authorizeAuditQuery(stranger, undefined)
      assert.equal(audit.allow, true)
    } finally {
      env.authzEnforce = prev
      await setAuthzEnforce(true)
    }
  })

  await it('create_namespace instance permission skips pending gate', async () => {
    const u = mkUser('create-ns-perm')
    await writeInstancePermissions(u, ['create_namespace'])
    assert.equal(await canSkipPendingGate(u), true)
    assert.equal(await isPendingUser(u), false)
    assert.equal(await hasInstancePermission(u, 'create_namespace'), true)
  })

  await it('view_audit is an instance permission grant', async () => {
    const u = mkUser('audit-mgr')
    await writeInstancePermissions(u, ['view_audit'])
    assert.equal(await hasInstancePermission(u, 'view_audit'), true)
    assert.equal(await hasInstancePermission(u, 'create_namespace'), false)
  })

  await it('setInstancePermissions requires instance admin actor', async () => {
    const actor = mkUser('not-admin-actor')
    const target = mkUser('perm-target')
    const denied = await setInstancePermissions(actor, target, ['view_audit'])
    assert.equal(denied.ok, false)
    const ok = await setInstancePermissions(admin, target, ['view_audit'])
    assert.equal(ok.ok, true)
    assert.equal(await hasInstancePermission(target, 'view_audit'), true)
  })

  await it('addInstanceAdmin rejects non-admin actor', async () => {
    const actor = mkUser('not-admin-add')
    const target = mkUser('would-be-admin')
    const r = await addInstanceAdmin(actor, target)
    assert.equal(r.ok, false)
    assert.equal(await isInstanceAdmin(target), false)
  })
})

await describe('access requests', async () => {
  await it('duplicate submit returns the same pending request', async () => {
    const u = mkUser('dup-req')
    const a = await submitAccessRequest(u, 'first')
    const b = await submitAccessRequest(u, 'second')
    assert.equal(a.id, b.id)
    assert.equal(a.message, 'first')
  })

  await it('deny access request leaves user pending', async () => {
    const u = mkUser('deny-me')
    const req = await submitAccessRequest(u, 'nope')
    const resolved = await resolveAccessRequest(admin, req.id, 'deny')
    assert.equal(resolved.ok, true)
    if (!resolved.ok) return
    assert.equal(resolved.request.status, 'denied')
    assert.equal(await isPendingUser(u), true)
    const again = await resolveAccessRequest(admin, req.id, 'approve', {
      permission: 'create_namespace',
    })
    assert.equal(again.ok, false)
  })

  await it('approve with namespace+role clears pending', async () => {
    const ns = 'tc-ar-ns'
    await createNamespaceAuthz(admin, ns, 'read', true)
    const u = mkUser('ar-member')
    const req = await submitAccessRequest(u, 'join')
    const resolved = await resolveAccessRequest(admin, req.id, 'approve', {
      namespace: ns,
      role: 'member',
    })
    assert.equal(resolved.ok, true)
    assert.equal(await isPendingUser(u), false)
    assert.equal((await hasRepoPermission(u, ns, 'r', 'read')).ok, true)
  })

  await it('non-reviewer cannot deny or approve', async () => {
    const ns = 'tc-ar-forbid'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const member = mkUser('plain-member')
    await setNamespaceMember(ns, member, 'member')
    const u = mkUser('ar-victim')
    const req = await submitAccessRequest(u, 'please')
    assert.equal(await canReviewAccessRequests(member), false)
    const deny = await resolveAccessRequest(member, req.id, 'deny')
    assert.equal(deny.ok, false)
    const approve = await resolveAccessRequest(member, req.id, 'approve', {
      namespace: ns,
      role: 'member',
    })
    assert.equal(approve.ok, false)
  })

  await it('custom review_access_requests role can approve into that namespace', async () => {
    const ns = 'tc-ar-reviewer'
    await createNamespaceAuthz(admin, ns, 'read', true)
    const role = await createCustomNamespaceRole(ns, {
      name: 'Reviewer',
      permissions: ['review_access_requests'],
    })
    assert.equal(role.ok, true)
    if (!role.ok) return
    const reviewer = mkUser('ns-reviewer')
    await setNamespaceMember(ns, reviewer, role.role.id)
    assert.equal(await canReviewAccessRequests(reviewer), true)

    const u = mkUser('ar-into-ns')
    const req = await submitAccessRequest(u, 'join ns')
    const resolved = await resolveAccessRequest(reviewer, req.id, 'approve', {
      namespace: ns,
      role: 'member',
    })
    assert.equal(resolved.ok, true)
    assert.equal(await isPendingUser(u), false)
  })

  await it('ns reviewer cannot grant instance permissions', async () => {
    const ns = 'tc-ar-no-inst'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const role = await createCustomNamespaceRole(ns, {
      name: 'Reviewer2',
      permissions: ['review_access_requests'],
    })
    assert.equal(role.ok, true)
    if (!role.ok) return
    const reviewer = mkUser('ns-reviewer2')
    await setNamespaceMember(ns, reviewer, role.role.id)
    const u = mkUser('want-inst')
    const req = await submitAccessRequest(u, 'inst')
    const resolved = await resolveAccessRequest(reviewer, req.id, 'approve', {
      permission: 'create_namespace',
    })
    assert.equal(resolved.ok, false)
  })
})

await describe('custom roles CRUD and capabilities', async () => {
  await it('custom ns role baseRepositoryRole is additive', async () => {
    const ns = 'tc-base-repo'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const created = await createCustomNamespaceRole(ns, {
      name: 'Writers',
      permissions: ['create_repos'],
      baseRepositoryRole: 'write',
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    const u = mkUser('base-writer')
    await setNamespaceMember(ns, u, created.role.id)
    assert.equal(await effectiveRepoRole(u, ns, 'any'), 'write')
    assert.equal(await hasNamespaceCapability(ns, u, 'create_repos'), true)
    const d = await authorizeApiRequest({
      user: u,
      via: 'session',
      method: 'POST',
      pathname: '/api/repos',
      createNamespace: ns,
      createRepo: 'new',
    })
    assert.equal(d.allow, true)
  })

  await it('delete_namespace capability for custom role', async () => {
    const ns = 'tc-del-cap'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const created = await createCustomNamespaceRole(ns, {
      name: 'Deleter',
      permissions: ['delete_namespace'],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    const u = mkUser('ns-deleter')
    await setNamespaceMember(ns, u, created.role.id)
    assert.equal(await hasNamespaceCapability(ns, u, 'delete_namespace'), true)
    assert.equal(await hasNamespaceCapability(ns, u, 'manage_members'), false)
  })

  await it('update and delete custom namespace role; block delete when assigned', async () => {
    const ns = 'tc-ns-crud'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const created = await createCustomNamespaceRole(ns, {
      name: 'Temp',
      permissions: ['manage_settings'],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    const id = created.role.id
    const updated = await updateCustomNamespaceRole(ns, id, {
      name: 'Temp2',
      permissions: ['manage_settings', 'manage_members'],
    })
    assert.equal(updated.ok, true)

    const u = mkUser('assigned-ns-role')
    await setNamespaceMember(ns, u, id)
    assert.equal(await isCustomNamespaceRoleAssigned(ns, id), true)
    const blocked = await deleteCustomNamespaceRole(ns, id, true)
    assert.equal(blocked.ok, false)

    await removeNamespaceMember(ns, u)
    assert.equal(await isCustomNamespaceRoleAssigned(ns, id), false)
    const deleted = await deleteCustomNamespaceRole(ns, id, false)
    assert.equal(deleted.ok, true)
  })

  await it('update and delete custom repo role; block delete when assigned', async () => {
    const ns = 'tc-repo-crud'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const created = await createCustomRepoRole(ns, {
      name: 'Editor',
      base: 'write',
      permissions: ['merge'],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    const id = created.role.id
    const updated = await updateCustomRepoRole(ns, id, {
      name: 'Editor+',
      permissions: ['merge', 'delete_branch'],
    })
    assert.equal(updated.ok, true)

    await setRepoCollaborator(ns, 'r1', bob, id)
    assert.equal(await isCustomRepoRoleAssigned(ns, id), true)
    const blocked = await deleteCustomRepoRole(ns, id, true)
    assert.equal(blocked.ok, false)

    await removeRepoCollaborator(ns, 'r1', bob)
    assert.equal(await isCustomRepoRoleAssigned(ns, id), false)
    const deleted = await deleteCustomRepoRole(ns, id, false)
    assert.equal(deleted.ok, true)
  })

  await it('manage_collaborators fine permission grants canManageRepoCollaborators', async () => {
    const ns = 'tc-mgr-collab'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const created = await createCustomRepoRole(ns, {
      name: 'CollabMgr',
      base: 'read',
      permissions: ['manage_collaborators'],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    const u = mkUser('collab-mgr')
    await setRepoCollaborator(ns, 'r1', u, created.role.id)
    assert.equal(await canManageRepoCollaborators(u, ns, 'r1'), true)
    assert.equal(await canManageRepoCollaborators(u, ns, 'other'), false)
  })

  await it('deleting a namespace removes its custom roles', async () => {
    const ns = 'tc-roles-cleanup'
    await createNamespaceAuthz(admin, ns, 'none', true)
    await createCustomNamespaceRole(ns, {
      name: 'X',
      permissions: ['view_audit'],
    })
    await createCustomRepoRole(ns, {
      name: 'Y',
      base: 'read',
      permissions: [],
    })
    await deleteNamespaceAuthz(ns)
    assert.equal(await getNamespace(ns), null)
    assert.deepEqual(await listCustomNamespaceRoles(ns), [])
  })

  await it('finePermissionForAction maps oxen actions', () => {
    assert.equal(finePermissionForAction('GET', 'other'), 'contents_read')
    assert.equal(finePermissionForAction('PUT', 'file.write'), 'contents_write')
    assert.equal(finePermissionForAction('POST', 'merge'), 'merge')
    assert.equal(finePermissionForAction('DELETE', 'branch.delete'), 'delete_branch')
    assert.equal(finePermissionForAction('DELETE', 'repo.delete'), 'repo_delete')
    assert.equal(finePermissionForAction('POST', 'workspace.create'), 'workspaces')
    assert.equal(finePermissionForAction('POST', 'repo.create'), null)
    assert.equal(finePermissionForAction('PATCH', 'repo.metadata'), 'manage_repo_metadata')
    assert.equal(finePermissionForAction('POST', 'job.cancel'), 'job_cancel')
    assert.equal(finePermissionForAction('POST', 'job.complete'), 'job_complete')
    assert.equal(finePermissionForAction('GET', 'lineage.read'), 'lineage_read')
    assert.equal(finePermissionForAction('GET', 'job.read'), 'job_read')
    assert.equal(finePermissionForAction('POST', 'lineage.rebuild'), 'lineage_rebuild')
    assert.equal(finePermissionForAction('PATCH', 'mystery'), 'other_mutate')
  })
})

await describe('atomic instance + job gates', async () => {
  await it('manage_own_tokens and cli_device_approve deny without grant under enforce', async () => {
    const u = mkUser('token-cli-user')
    await writeInstancePermissions(u, [])
    await setAuthzEnforce(true)
    assert.equal((await authorizeManageOwnTokens(u)).allow, false)
    assert.equal((await authorizeCliDeviceApprove(u)).allow, false)
    await writeInstancePermissions(u, ['manage_own_tokens', 'cli_device_approve'])
    assert.equal((await authorizeManageOwnTokens(u)).allow, true)
    assert.equal((await authorizeCliDeviceApprove(u)).allow, true)
    await writeInstancePermissions(u, [])
  })

  await it('job cancel/complete implied by write; custom role can grant cancel without submit', async () => {
    const ns = 'tc-job-atomic'
    const repo = 'r1'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const writer = mkUser('job-writer')
    const cancelOnly = mkUser('job-cancel-only')
    await setRepoCollaborator(ns, repo, writer, 'write')
    const role = await createCustomRepoRole(ns, {
      name: 'Cancel only',
      base: 'read',
      permissions: ['job_cancel'],
    })
    assert.equal(role.ok, true)
    if (!role.ok) return
    await setRepoCollaborator(ns, repo, cancelOnly, role.role.id)

    await setAuthzEnforce(true)
    assert.equal((await authorizeRepoAction(writer, ns, repo, 'job.cancel')).allow, true)
    assert.equal((await authorizeRepoAction(writer, ns, repo, 'job.complete')).allow, true)
    assert.equal((await authorizeRepoAction(writer, ns, repo, 'job.submit')).allow, true)

    assert.equal((await authorizeRepoAction(cancelOnly, ns, repo, 'job.cancel')).allow, true)
    assert.equal((await authorizeRepoAction(cancelOnly, ns, repo, 'job.submit')).allow, false)
    assert.equal((await authorizeRepoAction(cancelOnly, ns, repo, 'job.complete')).allow, false)
    assert.equal((await authorizeRepoAction(cancelOnly, ns, repo, 'job.read')).allow, true)
  })

  await it('ns view_lineage allows lineage query without repo collab', async () => {
    const ns = 'tc-ns-lineage'
    const repo = 'r1'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const viewer = mkUser('ns-lin-viewer')
    const role = await createCustomNamespaceRole(ns, {
      name: 'Lineage viewer',
      permissions: ['view_lineage'],
    })
    assert.equal(role.ok, true)
    if (!role.ok) return
    await setNamespaceMember(ns, viewer, role.role.id)
    await setAuthzEnforce(true)
    assert.equal((await authorizeLineageQuery(viewer, ns, repo)).allow, true)
  })
})

await describe('lineage ACL', async () => {
  await it('authorizeLineageQuery: enforce off → allow; outsider denied; reader allowed', async () => {
    const ns = 'tc-lineage-acl'
    const repo = 'r1'
    await createNamespaceAuthz(admin, ns, 'none', true)
    await setRepoCollaborator(ns, repo, alice, 'read')

    const prev = env.authzEnforce
    env.authzEnforce = 'false'
    try {
      assert.equal((await authorizeLineageQuery(mkUser('anyone'), ns, repo)).allow, true)
    } finally {
      env.authzEnforce = prev
      await setAuthzEnforce(true)
    }

    const outsider = mkUser('lin-outsider')
    await writeInstancePermissions(outsider, [])
    assert.equal((await authorizeLineageQuery(outsider, ns, repo)).allow, false)

    assert.equal((await authorizeLineageQuery(alice, ns, repo)).allow, true)

    const missingNs = await authorizeLineageQuery(alice, undefined, undefined)
    assert.equal(missingNs.allow, false)

    await writeInstancePermissions(bob, ['view_lineage'])
    assert.equal((await authorizeLineageQuery(bob, undefined, undefined)).allow, true)
    await writeInstancePermissions(bob, [])
  })

  await it('authorizeLineageRebuild: requires repo admin (or owner / instance admin)', async () => {
    const ns = 'tc-lineage-rebuild'
    const repo = 'r1'
    await createNamespaceAuthz(admin, ns, 'none', true)
    await setNamespaceMember(ns, alice, 'owner')
    await setRepoCollaborator(ns, repo, bob, 'write')

    await setAuthzEnforce(true)
    assert.equal((await authorizeLineageRebuild(bob, ns, repo)).allow, false)
    assert.equal((await authorizeLineageRebuild(alice, ns, repo)).allow, true)
    assert.equal((await authorizeLineageRebuild(admin, ns, repo)).allow, true)

    await setRepoCollaborator(ns, repo, bob, 'admin')
    assert.equal((await authorizeLineageRebuild(bob, ns, repo)).allow, true)

    const prev = env.authzEnforce
    env.authzEnforce = 'false'
    try {
      assert.equal(
        (await authorizeLineageRebuild(mkUser('stranger'), ns, repo)).allow,
        true,
      )
    } finally {
      env.authzEnforce = prev
      await setAuthzEnforce(true)
    }
  })
})

await describe('audit ACL and path classification', async () => {
  await it('authorizeAuditQuery denies outsider and foreign namespace', async () => {
    const ns = 'tc-audit-acl'
    await createNamespaceAuthz(admin, ns, 'none', true)
    await setNamespaceMember(ns, alice, 'owner')
    const outsider = mkUser('audit-outsider')
    await writeInstancePermissions(outsider, [])
    const denied = await authorizeAuditQuery(outsider, undefined)
    assert.equal(denied.allow, false)

    const other = await authorizeAuditQuery(alice, 'not-alice-ns')
    assert.equal(other.allow, false)

    const scoped = await authorizeAuditQuery(alice, ns)
    assert.equal(scoped.allow, true)
    assert.equal(scoped.forceNamespace, ns)
  })

  await it('multi-namespace owner gets ownedOnly list', async () => {
    const a = 'tc-audit-a'
    const b = 'tc-audit-b'
    await createNamespaceAuthz(admin, a, 'none', true)
    await createNamespaceAuthz(admin, b, 'none', true)
    const u = mkUser('multi-owner')
    await setNamespaceMember(a, u, 'owner')
    await setNamespaceMember(b, u, 'owner')
    // demote admin ownership for isolation is hard; alice-style: use fresh ns only owners
    const gate = await authorizeAuditQuery(u, undefined)
    assert.equal(gate.allow, true)
    assert.ok(gate.ownedOnly?.includes(a))
    assert.ok(gate.ownedOnly?.includes(b))
  })

  await it('classifyPath covers create, file, branch, merge, workspace, delete', () => {
    assert.equal(classifyPath('POST', '/api/repos').action, 'repo.create')
    assert.equal(
      classifyPath('PUT', '/api/repos/n/r/file/main/a.txt').action,
      'file.write',
    )
    const br = classifyPath('POST', '/api/repos/n/r/branches')
    assert.equal(br.namespace, 'n')
    assert.equal(br.repo, 'r')
    assert.ok(br.action.startsWith('branch'))
    const delBr = classifyPath('DELETE', '/api/repos/n/r/branches/main')
    assert.equal(delBr.action, 'branch.delete')
    const merge = classifyPath('POST', '/api/repos/n/r/merge')
    assert.ok(merge.action === 'merge' || merge.action.includes('merge'))
    const ws = classifyPath('POST', '/api/repos/n/r/workspaces')
    assert.ok(ws.action.startsWith('workspace'))
    assert.equal(classifyPath('DELETE', '/api/repos/n/r').action, 'repo.delete')
  })

  await it('classifyPath distinguishes file delete and workspace operations', () => {
    const del = classifyPath('DELETE', '/api/repos/n/r/file/main/a.txt')
    assert.equal(del.action, 'file.delete')
    assert.equal(del.detail?.path, 'a.txt')
    const cases: Array<[string, string, string]> = [
      ['POST', '/api/repos/n/r/workspaces', 'workspace.create'],
      ['DELETE', '/api/repos/n/r/workspaces/w1', 'workspace.delete'],
      ['POST', '/api/repos/n/r/workspaces/w1/commit/main', 'workspace.commit'],
      ['PUT', '/api/repos/n/r/workspaces/w1/files/a.txt', 'workspace.file.write'],
      ['DELETE', '/api/repos/n/r/workspaces/w1/files/a.txt', 'workspace.file.delete'],
      ['POST', '/api/repos/n/r/workspaces/w1/merge/main', 'workspace.merge'],
      ['PUT', '/api/repos/n/r/workspaces/w1/other', 'workspace.other'],
    ]
    for (const [method, path, action] of cases) {
      const c = classifyPath(method, path)
      assert.equal(c.action, action, `${method} ${path}`)
      assert.equal(c.namespace, 'n')
      assert.equal(c.repo, 'r')
      // Authz keys must be unchanged by the finer audit names.
      assert.equal(requiredRepoRoleForRequest(method, path), 'write')
      assert.equal(finePermissionForAction(method, c.action), 'workspaces')
    }
    assert.equal(classifyPath('POST', '/api/repos/n/r/workspaces/w1/commit/main').detail?.workspace_id, 'w1')
    assert.equal(
      requiredRepoRoleForRequest('DELETE', '/api/repos/n/r/file/main/a'),
      'write',
    )
    assert.equal(finePermissionForAction('DELETE', 'file.delete'), 'contents_write')
  })
})

await describe('repo / namespace API decisions', async () => {
  await it('list repos in namespace denied for non-members (admin bypass)', async () => {
    const ns = 'tc-list-ns'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const outsider = mkUser('list-outsider')
    const denied = await authorizeApiRequest({
      user: outsider,
      via: 'session',
      method: 'GET',
      pathname: `/api/repos/${ns}`,
    })
    assert.equal(denied.allow, false)

    const bypass = await authorizeApiRequest({
      user: admin,
      via: 'session',
      method: 'GET',
      pathname: `/api/repos/${ns}`,
    })
    // admin is Owner of ns from create — allow without needing bypass
    assert.equal(bypass.allow, true)
  })

  await it('site admin bypass when not a member of listed namespace', async () => {
    const ns = 'tc-list-bypass'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const admin2 = mkUser('list-admin2')
    await addInstanceAdmin(admin, admin2)
    // remove any accidental membership — admin2 has none
    const d = await authorizeApiRequest({
      user: admin2,
      via: 'session',
      method: 'GET',
      pathname: `/api/repos/${ns}`,
    })
    assert.equal(d.allow, true)
    assert.equal(d.siteAdminBypass, true)
  })

  await it('namespace.create requires create_namespace or instance admin', async () => {
    const u = mkUser('ns-create-deny')
    const ns = 'tc-ns-create-grant'
    await createNamespaceAuthz(admin, ns, 'read', true)
    await setNamespaceMember(ns, u, 'member')
    const denied = await authorizeApiRequest({
      user: u,
      via: 'session',
      method: 'POST',
      pathname: '/api/namespaces',
    })
    assert.equal(denied.allow, false)

    const withPerm = mkUser('ns-create-ok')
    await writeInstancePermissions(withPerm, ['create_namespace'])
    const allowed = await authorizeApiRequest({
      user: withPerm,
      via: 'session',
      method: 'POST',
      pathname: '/api/namespaces',
    })
    assert.equal(allowed.allow, true)
  })

  await it('removeRepoCollaborator clears outside collaborator access', async () => {
    const ns = 'tc-rm-collab'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const u = mkUser('temp-collab')
    await setRepoCollaborator(ns, 'only', u, 'write')
    assert.equal((await hasRepoPermission(u, ns, 'only', 'write')).ok, true)
    assert.equal(await removeRepoCollaborator(ns, 'only', u), true)
    assert.equal((await hasRepoPermission(u, ns, 'only', 'read')).ok, false)
    assert.equal(await isPendingUser(u), true)
  })

  await it('PAT scopes on instance admin do not widen beyond maxRole', async () => {
    const ns = 'tc-pat-admin'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const { token } = await createPat(admin, 'capped', [
      { namespace: ns, repo: 'r1', maxRole: 'read' },
    ])
    const patUser = await resolvePat(token)
    assert.ok(patUser)
    assert.equal((await hasRepoPermission(patUser!, ns, 'r1', 'read')).ok, true)
    assert.equal((await hasRepoPermission(patUser!, ns, 'r1', 'write')).ok, false)
  })

  await it('PAT access shrinks immediately when the minting user loses a direct grant', async () => {
    const ns = 'tc-pat-shrink'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const u = mkUser('pat-shrink-user')
    await setRepoCollaborator(ns, 'r', u, 'write')
    const { token } = await createPat(u, 'shrink', [{ namespace: ns, repo: 'r', maxRole: 'write' }])
    const pat = await resolvePat(token)
    assert.ok(pat)
    assert.equal((await hasRepoPermission(pat!, ns, 'r', 'write')).ok, true)

    await setRepoCollaborator(ns, 'r', u, 'read')
    assert.equal((await hasRepoPermission(pat!, ns, 'r', 'write')).ok, false)
    assert.equal((await hasRepoPermission(pat!, ns, 'r', 'read')).ok, true)

    await removeRepoCollaborator(ns, 'r', u)
    const again = await resolvePat(token)
    assert.ok(again)
    assert.equal((await hasRepoPermission(again!, ns, 'r', 'read')).ok, false)
  })

  await it('PAT never exceeds its scope even when the user later gains more', async () => {
    const ns = 'tc-pat-no-grow'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const u = mkUser('pat-no-grow-user')
    await setRepoCollaborator(ns, 'r', u, 'read')
    const { token } = await createPat(u, 'no-grow', [{ namespace: ns, repo: 'r', maxRole: 'read' }])
    await setRepoCollaborator(ns, 'r', u, 'admin')
    const pat = await resolvePat(token)
    assert.ok(pat)
    assert.equal((await hasRepoPermission(pat!, ns, 'r', 'write')).ok, false)
  })

  await it('updateNamespaceSettings basePermission affects members', async () => {
    const ns = 'tc-base-patch'
    await createNamespaceAuthz(admin, ns, 'none', true)
    const u = mkUser('base-patch-user')
    await setNamespaceMember(ns, u, 'member')
    assert.equal((await hasRepoPermission(u, ns, 'r', 'read')).ok, false)
    await updateNamespaceSettings(ns, { basePermission: 'read' })
    assert.equal((await hasRepoPermission(u, ns, 'r', 'read')).ok, true)
    assert.equal((await hasRepoPermission(u, ns, 'r', 'write')).ok, false)
  })
})
