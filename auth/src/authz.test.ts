import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

const dataDir = mkdtempSync(join(tmpdir(), 'boxen-authz-'))

process.env.AUTH_DATA_DIR = dataDir
process.env.AUTHZ_ENFORCE = 'true'
process.env.AUTH_DEV_MODE = 'false'
process.env.AUTHZ_DEV_GRANT_ALL = 'false'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@boxen.local'
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
  canManageRepoCollaborators,
  canSkipPendingGate,
  effectiveRepoRole,
  hasRepoPermission,
  isPendingUser,
  preparePrincipal,
  requiredRepoRoleForRequest,
} = await import('./authz.js')
const {
  addInstanceAdmin,
  createNamespaceAuthz,
  deleteNamespaceAuthz,
  hasInstancePermission,
  hasNamespaceCapability,
  isAuthzEnforce,
  isCustomNamespaceRoleAssigned,
  isCustomRepoRoleAssigned,
  isInstanceAdmin,
  removeRepoCollaborator,
  setAuthzEnforce,
  setInstancePermissions,
  setNamespaceMember,
  setNamespaceGroupMember,
  setRepoCollaborator,
  setRepoGroupCollaborator,
  removeInstanceAdmin,
  removeNamespaceMember,
  removeNamespaceGroupMember,
  listInstanceAdmins,
  listNamespaceMembers,
  updateNamespaceSettings,
  setTrainingCompletedSelf,
  hasCompletedTraining,
  writeInstancePermissions,
  getNamespace,
} = await import('./authzStore.js')
const {
  canReviewAccessRequests,
  submitAccessRequest,
  resolveAccessRequest,
} = await import('./accessRequests.js')
const { createPat, resolvePat } = await import('./tokens.js')
const { OXEN_PATH_ROLE_MAP } = await import('./authzPathMap.js')
const { classifyPath } = await import('./audit.js')
const { env } = await import('./env.js')
const {
  createCustomNamespaceRole,
  createCustomRepoRole,
  deleteCustomNamespaceRole,
  deleteCustomRepoRole,
  deleteCustomRolesForNamespace,
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
  email: 'admin@boxen.local',
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

before(() => {
  setAuthzEnforce(true)
  preparePrincipal(admin)
})

after(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

describe('TC-AUTHO matrix', () => {
  it('TC-AUTHO-01: zero grants → pending + /api denied', () => {
    const stranger = {
      sub: 'stranger',
      iss: 'test',
      email: 'stranger@example.com',
      name: 'Stranger',
    }
    assert.equal(isPendingUser(stranger), true)
    const d = authorizeApiRequest({
      user: stranger,
      via: 'session',
      method: 'GET',
      pathname: '/api/repos/ns/repo',
    })
    assert.equal(d.allow, false)
  })

  it('TC-AUTHO-02: instance admin can create namespace', () => {
    const r = createNamespaceAuthz(admin, 'tc02-ns', 'none', true)
    assert.equal(r.ok, true)
  })

  it('TC-AUTHO-03: member base none cannot read', () => {
    const ns = 'tc03'
    createNamespaceAuthz(admin, ns, 'none', true)
    setNamespaceMember(ns, alice, 'member')
    assert.equal(hasRepoPermission(alice, ns, 'r', 'read').ok, false)
  })

  it('TC-AUTHO-04: member base read can read not write', () => {
    const ns = 'tc04'
    createNamespaceAuthz(admin, ns, 'read', true)
    setNamespaceMember(ns, alice, 'member')
    assert.equal(hasRepoPermission(alice, ns, 'r', 'read').ok, true)
    assert.equal(hasRepoPermission(alice, ns, 'r', 'write').ok, false)
  })

  it('TC-AUTHO-05: Owner implicit admin', () => {
    const ns = 'tc05'
    createNamespaceAuthz(admin, ns, 'none', true)
    assert.equal(effectiveRepoRole(admin, ns, 'any'), 'admin')
  })

  it('TC-AUTHO-06: outside collaborator write only that repo', () => {
    const ns = 'tc06'
    createNamespaceAuthz(admin, ns, 'none', true)
    setRepoCollaborator(ns, 'only', bob, 'write')
    assert.equal(isPendingUser(bob), false)
    assert.equal(hasRepoPermission(bob, ns, 'only', 'write').ok, true)
    assert.equal(hasRepoPermission(bob, ns, 'other', 'read').ok, false)
  })

  it('TC-AUTHO-07: additive base read + direct write', () => {
    const ns = 'tc07'
    createNamespaceAuthz(admin, ns, 'read', true)
    setNamespaceMember(ns, alice, 'member')
    setRepoCollaborator(ns, 'repo', alice, 'write')
    assert.equal(effectiveRepoRole(alice, ns, 'repo'), 'write')
  })

  it('TC-AUTHO-08: insufficient role → 403 decision', () => {
    const ns = 'tc08'
    createNamespaceAuthz(admin, ns, 'read', true)
    setNamespaceMember(ns, alice, 'member')
    const d = authorizeApiRequest({
      user: alice,
      via: 'session',
      method: 'PUT',
      pathname: `/api/repos/${ns}/repo/file/main/a.txt`,
    })
    assert.equal(d.allow, false)
  })

  it('TC-AUTHO-09: cannot remove last Owner', () => {
    const ns = 'tc09'
    createNamespaceAuthz(admin, ns, 'none', true)
    const r = removeNamespaceMember(ns, admin)
    assert.equal(r.ok, false)
  })

  it('TC-AUTHO-10: cannot remove last instance admin', () => {
    const admins = listInstanceAdmins()
    assert.ok(admins.length >= 1)
    // Ensure only one admin then try remove
    for (const a of admins) {
      if (a.sub !== admin.sub) removeInstanceAdmin(admin, a)
    }
    const r = removeInstanceAdmin(admin, admin)
    assert.equal(r.ok, false)
  })

  it('TC-AUTHO-11: site admin bypass when no grant', () => {
    const ns = 'tc11'
    createNamespaceAuthz(admin, ns, 'none', true)
    const admin2 = {
      sub: 'admin2',
      iss: 'test',
      email: 'admin2@boxen.local',
      name: 'Admin2',
    }
    addInstanceAdmin(admin, admin2)
    const d = authorizeApiRequest({
      user: admin2,
      via: 'session',
      method: 'GET',
      pathname: `/api/repos/${ns}/secret`,
    })
    assert.equal(d.allow, true)
    assert.equal(d.siteAdminBypass, true)
  })

  it('TC-AUTHO-12: Owner audit scoped; view_audit instance-wide', () => {
    const ns = 'tc12'
    createNamespaceAuthz(admin, ns, 'none', true)
    setNamespaceMember(ns, alice, 'owner')
    // demote admin? keep alice as second owner
    const gate = authorizeAuditQuery(alice, undefined)
    assert.equal(gate.allow, true)
    assert.ok(gate.forceNamespace === ns || gate.ownedOnly?.includes(ns))

    writeInstancePermissions(bob, ['view_audit'])
    const g2 = authorizeAuditQuery(bob, undefined)
    assert.equal(g2.allow, true)
    assert.equal(g2.forceNamespace, undefined)
  })

  it('TC-AUTHO-13: PAT scopes cannot exceed / widen access', () => {
    const ns = 'tc13'
    createNamespaceAuthz(admin, ns, 'write', true)
    setNamespaceMember(ns, alice, 'member')
    const { token } = createPat(alice, 'scoped', [
      { namespace: ns, repo: 'r1', maxRole: 'read' },
    ])
    const patUser = resolvePat(token)
    assert.ok(patUser)
    assert.equal(hasRepoPermission(patUser!, ns, 'r1', 'read').ok, true)
    assert.equal(hasRepoPermission(patUser!, ns, 'r1', 'write').ok, false)
  })

  it('TC-AUTHO-14: membersCanCreateRepos off denies members', () => {
    const ns = 'tc14'
    createNamespaceAuthz(admin, ns, 'read', true)
    updateNamespaceSettings(ns, { membersCanCreateRepos: false })
    setNamespaceMember(ns, alice, 'member')
    const d = authorizeApiRequest({
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

describe('Phase 2–3 extras', () => {
  it('access request submit + approve', () => {
    const req = submitAccessRequest(bob, 'please')
    assert.equal(req.status, 'pending')
    const resolved = resolveAccessRequest(admin, req.id, 'approve', {
      permission: 'create_namespace',
    })
    assert.equal(resolved.ok, true)
  })

  it('group bootstrap creates namespace membership', () => {
    preparePrincipal(alice)
    // alice email maps to from-group
    assert.equal(isPendingUser(alice), false)
  })

  it('IdP group member gets base permission', () => {
    const ns = 'tc-group-member'
    createNamespaceAuthz(admin, ns, 'read', true)
    setNamespaceGroupMember(ns, 'engineering', 'member')
    const carol = {
      sub: 'carol',
      iss: 'test',
      email: 'carol@example.com',
      name: 'Carol',
      groups: ['Engineering'],
    }
    assert.equal(isPendingUser(carol), false)
    assert.equal(hasRepoPermission(carol, ns, 'r', 'read').ok, true)
    assert.equal(hasRepoPermission(carol, ns, 'r', 'write').ok, false)
  })

  it('IdP group collaborator grants repo role', () => {
    const ns = 'tc-group-collab'
    createNamespaceAuthz(admin, ns, 'none', true)
    setRepoGroupCollaborator(ns, 'data', 'contractors', 'write')
    const dave = {
      sub: 'dave',
      iss: 'test',
      email: 'dave@example.com',
      name: 'Dave',
      groups: ['contractors'],
    }
    assert.equal(hasRepoPermission(dave, ns, 'data', 'write').ok, true)
    assert.equal(hasRepoPermission(dave, ns, 'other', 'read').ok, false)
  })

  it('additive user + group grants take max role', () => {
    const ns = 'tc-group-add'
    createNamespaceAuthz(admin, ns, 'read', true)
    setNamespaceMember(ns, alice, 'member')
    setRepoGroupCollaborator(ns, 'repo', 'leads', 'maintain')
    const withGroup = { ...alice, groups: ['leads'] }
    assert.equal(effectiveRepoRole(withGroup, ns, 'repo'), 'maintain')
  })

  it('leaving IdP group loses group-derived access', () => {
    const ns = 'tc-group-leave'
    createNamespaceAuthz(admin, ns, 'read', true)
    setNamespaceGroupMember(ns, 'temp', 'member')
    const eve = {
      sub: 'eve',
      iss: 'test',
      email: 'eve@example.com',
      name: 'Eve',
      groups: ['temp'],
    }
    assert.equal(hasRepoPermission(eve, ns, 'r', 'read').ok, true)
    const left = { ...eve, groups: [] }
    assert.equal(hasRepoPermission(left, ns, 'r', 'read').ok, false)
    assert.equal(isPendingUser(left), true)
  })

  it('cannot remove last Owner when only group Owner remains', () => {
    const ns = 'tc-group-owner'
    createNamespaceAuthz(admin, ns, 'none', true)
    setNamespaceGroupMember(ns, 'owners', 'owner')
    // Remove user Owner — group Owner remains
    const r = removeNamespaceMember(ns, admin)
    assert.equal(r.ok, true)
    const r2 = removeNamespaceGroupMember(ns, 'owners')
    assert.equal(r2.ok, false)
    const listed = listNamespaceMembers(ns)
    assert.ok(listed.some((m) => m.kind === 'group' && m.group === 'owners'))
  })

  it('PAT snapshots groups at mint', () => {
    const ns = 'tc-pat-groups'
    createNamespaceAuthz(admin, ns, 'read', true)
    setNamespaceGroupMember(ns, 'pat-team', 'member')
    const frank = {
      sub: 'frank',
      iss: 'test',
      email: 'frank@example.com',
      name: 'Frank',
      groups: ['pat-team'],
    }
    const { token } = createPat(frank, 'with-groups')
    const patUser = resolvePat(token)
    assert.ok(patUser)
    assert.deepEqual(patUser!.groups, ['pat-team'])
    assert.equal(hasRepoPermission(patUser!, ns, 'r', 'read').ok, true)
  })

  it('training gate blocks until completed', () => {
    const trainee = mkUser('trainee-gate')
    const ns = 'tc-train'
    createNamespaceAuthz(admin, ns, 'read', true)
    setNamespaceMember(ns, trainee, 'member')
    setTrainingCompletedSelf(trainee, false)

    const prev = env.authzRequireTraining
    env.authzRequireTraining = true
    try {
      const denied = authorizeApiRequest({
        user: trainee,
        via: 'session',
        method: 'GET',
        pathname: `/api/repos/${ns}/r`,
      })
      assert.equal(denied.allow, false)
      assert.match(denied.reason ?? '', /Training/i)

      setTrainingCompletedSelf(trainee, true)
      const allowed = authorizeApiRequest({
        user: trainee,
        via: 'session',
        method: 'GET',
        pathname: `/api/repos/${ns}/r`,
      })
      assert.equal(allowed.allow, true)

      // Instance admins skip the training gate
      const adminOk = authorizeApiRequest({
        user: admin,
        via: 'session',
        method: 'GET',
        pathname: `/api/repos/${ns}/r`,
      })
      assert.equal(adminOk.allow, true)
    } finally {
      env.authzRequireTraining = prev
      setTrainingCompletedSelf(trainee, false)
    }
  })

  it('path role map is non-empty and aligns with requiredRepoRoleForRequest', () => {
    assert.ok(OXEN_PATH_ROLE_MAP.length >= 8)
    assert.equal(requiredRepoRoleForRequest('GET', '/api/repos/n/r', 'other'), 'read')
    assert.equal(
      requiredRepoRoleForRequest('PUT', '/api/repos/n/r/file/main/a', 'file.write'),
      'write',
    )
    assert.equal(
      requiredRepoRoleForRequest('POST', '/api/repos/n/r/merge', 'merge'),
      'maintain',
    )
    assert.equal(
      requiredRepoRoleForRequest('DELETE', '/api/repos/n/r', 'repo.delete'),
      'admin',
    )
    assert.equal(
      requiredRepoRoleForRequest('POST', '/api/repos/n/r/mystery', 'other'),
      'admin',
    )
  })

  it('deleteNamespaceAuthz removes settings and members', () => {
    const ns = 'to-delete'
    createNamespaceAuthz(admin, ns, 'none', true)
    setNamespaceMember(ns, alice, 'member')
    assert.ok(getNamespace(ns))
    const r = deleteNamespaceAuthz(ns)
    assert.equal(r.ok, true)
    assert.equal(getNamespace(ns), null)
  })

  it('custom repo role Write+merge allows merge without Maintain', async () => {
    const { createCustomRepoRole } = await import('./customRoles.js')
    const ns = 'tc-custom-repo'
    createNamespaceAuthz(admin, ns, 'none', true)
    const created = createCustomRepoRole(ns, {
      name: 'Merger',
      base: 'write',
      permissions: ['merge'],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    setRepoCollaborator(ns, 'r1', bob, created.role.id)
    assert.equal(hasRepoPermission(bob, ns, 'r1', 'write').ok, true)
    assert.equal(hasRepoPermission(bob, ns, 'r1', 'maintain').ok, false)
    assert.equal(
      hasRepoPermission(bob, ns, 'r1', 'maintain', {
        method: 'POST',
        action: 'merge',
      }).ok,
      true,
    )
    assert.equal(
      hasRepoPermission(bob, ns, 'r1', 'admin', {
        method: 'DELETE',
        action: 'repo.delete',
      }).ok,
      false,
    )
  })

  it('custom namespace role grants view_audit capability', () => {
    const ns = 'tc-custom-ns'
    createNamespaceAuthz(admin, ns, 'none', true)
    const created = createCustomNamespaceRole(ns, {
      name: 'Auditor',
      permissions: ['view_audit'],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    setNamespaceMember(ns, bob, created.role.id)
    assert.equal(hasNamespaceCapability(ns, bob, 'view_audit'), true)
    assert.equal(hasNamespaceCapability(ns, bob, 'manage_members'), false)
    const gate = authorizeAuditQuery(bob, ns)
    assert.equal(gate.allow, true)
  })
})

describe('enforcement gates', () => {
  it('breakglass via allows pending users', () => {
    const stranger = mkUser('breakglass-user')
    assert.equal(isPendingUser(stranger), true)
    const d = authorizeApiRequest({
      user: stranger,
      via: 'breakglass',
      method: 'GET',
      pathname: '/api/repos/ns/repo',
    })
    assert.equal(d.allow, true)
  })

  it('enforce off allows all /api decisions', () => {
    const stranger = mkUser('enforce-off-user')
    const prev = env.authzEnforce
    env.authzEnforce = 'false'
    try {
      assert.equal(isAuthzEnforce(), false)
      assert.equal(isPendingUser(stranger), false)
      const d = authorizeApiRequest({
        user: stranger,
        via: 'session',
        method: 'PUT',
        pathname: '/api/repos/ns/repo/file/main/a.txt',
      })
      assert.equal(d.allow, true)
      const audit = authorizeAuditQuery(stranger, undefined)
      assert.equal(audit.allow, true)
    } finally {
      env.authzEnforce = prev
      setAuthzEnforce(true)
    }
  })

  it('create_namespace instance permission skips pending gate', () => {
    const u = mkUser('create-ns-perm')
    writeInstancePermissions(u, ['create_namespace'])
    assert.equal(canSkipPendingGate(u), true)
    assert.equal(isPendingUser(u), false)
    assert.equal(hasInstancePermission(u, 'create_namespace'), true)
  })

  it('manage_breakglass is an instance permission grant', () => {
    const u = mkUser('bg-mgr')
    writeInstancePermissions(u, ['manage_breakglass'])
    assert.equal(hasInstancePermission(u, 'manage_breakglass'), true)
    assert.equal(hasInstancePermission(u, 'view_audit'), false)
  })

  it('setInstancePermissions requires instance admin actor', () => {
    const actor = mkUser('not-admin-actor')
    const target = mkUser('perm-target')
    const denied = setInstancePermissions(actor, target, ['view_audit'])
    assert.equal(denied.ok, false)
    const ok = setInstancePermissions(admin, target, ['view_audit'])
    assert.equal(ok.ok, true)
    assert.equal(hasInstancePermission(target, 'view_audit'), true)
  })

  it('addInstanceAdmin rejects non-admin actor', () => {
    const actor = mkUser('not-admin-add')
    const target = mkUser('would-be-admin')
    const r = addInstanceAdmin(actor, target)
    assert.equal(r.ok, false)
    assert.equal(isInstanceAdmin(target), false)
  })
})

describe('access requests', () => {
  it('duplicate submit returns the same pending request', () => {
    const u = mkUser('dup-req')
    const a = submitAccessRequest(u, 'first')
    const b = submitAccessRequest(u, 'second')
    assert.equal(a.id, b.id)
    assert.equal(a.message, 'first')
  })

  it('deny access request leaves user pending', () => {
    const u = mkUser('deny-me')
    const req = submitAccessRequest(u, 'nope')
    const resolved = resolveAccessRequest(admin, req.id, 'deny')
    assert.equal(resolved.ok, true)
    if (!resolved.ok) return
    assert.equal(resolved.request.status, 'denied')
    assert.equal(isPendingUser(u), true)
    const again = resolveAccessRequest(admin, req.id, 'approve', {
      permission: 'create_namespace',
    })
    assert.equal(again.ok, false)
  })

  it('approve with namespace+role clears pending', () => {
    const ns = 'tc-ar-ns'
    createNamespaceAuthz(admin, ns, 'read', true)
    const u = mkUser('ar-member')
    const req = submitAccessRequest(u, 'join')
    const resolved = resolveAccessRequest(admin, req.id, 'approve', {
      namespace: ns,
      role: 'member',
    })
    assert.equal(resolved.ok, true)
    assert.equal(isPendingUser(u), false)
    assert.equal(hasRepoPermission(u, ns, 'r', 'read').ok, true)
  })

  it('non-reviewer cannot deny or approve', () => {
    const ns = 'tc-ar-forbid'
    createNamespaceAuthz(admin, ns, 'none', true)
    const member = mkUser('plain-member')
    setNamespaceMember(ns, member, 'member')
    const u = mkUser('ar-victim')
    const req = submitAccessRequest(u, 'please')
    assert.equal(canReviewAccessRequests(member), false)
    const deny = resolveAccessRequest(member, req.id, 'deny')
    assert.equal(deny.ok, false)
    const approve = resolveAccessRequest(member, req.id, 'approve', {
      namespace: ns,
      role: 'member',
    })
    assert.equal(approve.ok, false)
  })

  it('custom review_access_requests role can approve into that namespace', () => {
    const ns = 'tc-ar-reviewer'
    createNamespaceAuthz(admin, ns, 'read', true)
    const role = createCustomNamespaceRole(ns, {
      name: 'Reviewer',
      permissions: ['review_access_requests'],
    })
    assert.equal(role.ok, true)
    if (!role.ok) return
    const reviewer = mkUser('ns-reviewer')
    setNamespaceMember(ns, reviewer, role.role.id)
    assert.equal(canReviewAccessRequests(reviewer), true)

    const u = mkUser('ar-into-ns')
    const req = submitAccessRequest(u, 'join ns')
    const resolved = resolveAccessRequest(reviewer, req.id, 'approve', {
      namespace: ns,
      role: 'member',
    })
    assert.equal(resolved.ok, true)
    assert.equal(isPendingUser(u), false)
  })

  it('ns reviewer cannot grant instance permissions', () => {
    const ns = 'tc-ar-no-inst'
    createNamespaceAuthz(admin, ns, 'none', true)
    const role = createCustomNamespaceRole(ns, {
      name: 'Reviewer2',
      permissions: ['review_access_requests'],
    })
    assert.equal(role.ok, true)
    if (!role.ok) return
    const reviewer = mkUser('ns-reviewer2')
    setNamespaceMember(ns, reviewer, role.role.id)
    const u = mkUser('want-inst')
    const req = submitAccessRequest(u, 'inst')
    const resolved = resolveAccessRequest(reviewer, req.id, 'approve', {
      permission: 'create_namespace',
    })
    assert.equal(resolved.ok, false)
  })
})

describe('custom roles CRUD and capabilities', () => {
  it('custom ns role baseRepositoryRole is additive', () => {
    const ns = 'tc-base-repo'
    createNamespaceAuthz(admin, ns, 'none', true)
    const created = createCustomNamespaceRole(ns, {
      name: 'Writers',
      permissions: ['create_repos'],
      baseRepositoryRole: 'write',
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    const u = mkUser('base-writer')
    setNamespaceMember(ns, u, created.role.id)
    assert.equal(effectiveRepoRole(u, ns, 'any'), 'write')
    assert.equal(hasNamespaceCapability(ns, u, 'create_repos'), true)
    const d = authorizeApiRequest({
      user: u,
      via: 'session',
      method: 'POST',
      pathname: '/api/repos',
      createNamespace: ns,
      createRepo: 'new',
    })
    assert.equal(d.allow, true)
  })

  it('delete_namespace capability for custom role', () => {
    const ns = 'tc-del-cap'
    createNamespaceAuthz(admin, ns, 'none', true)
    const created = createCustomNamespaceRole(ns, {
      name: 'Deleter',
      permissions: ['delete_namespace'],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    const u = mkUser('ns-deleter')
    setNamespaceMember(ns, u, created.role.id)
    assert.equal(hasNamespaceCapability(ns, u, 'delete_namespace'), true)
    assert.equal(hasNamespaceCapability(ns, u, 'manage_members'), false)
  })

  it('update and delete custom namespace role; block delete when assigned', () => {
    const ns = 'tc-ns-crud'
    createNamespaceAuthz(admin, ns, 'none', true)
    const created = createCustomNamespaceRole(ns, {
      name: 'Temp',
      permissions: ['manage_settings'],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    const id = created.role.id
    const updated = updateCustomNamespaceRole(ns, id, {
      name: 'Temp2',
      permissions: ['manage_settings', 'manage_members'],
    })
    assert.equal(updated.ok, true)

    const u = mkUser('assigned-ns-role')
    setNamespaceMember(ns, u, id)
    assert.equal(isCustomNamespaceRoleAssigned(ns, id), true)
    const blocked = deleteCustomNamespaceRole(ns, id, true)
    assert.equal(blocked.ok, false)

    removeNamespaceMember(ns, u)
    assert.equal(isCustomNamespaceRoleAssigned(ns, id), false)
    const deleted = deleteCustomNamespaceRole(ns, id, false)
    assert.equal(deleted.ok, true)
  })

  it('update and delete custom repo role; block delete when assigned', () => {
    const ns = 'tc-repo-crud'
    createNamespaceAuthz(admin, ns, 'none', true)
    const created = createCustomRepoRole(ns, {
      name: 'Editor',
      base: 'write',
      permissions: ['merge'],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    const id = created.role.id
    const updated = updateCustomRepoRole(ns, id, {
      name: 'Editor+',
      permissions: ['merge', 'delete_branch'],
    })
    assert.equal(updated.ok, true)

    setRepoCollaborator(ns, 'r1', bob, id)
    assert.equal(isCustomRepoRoleAssigned(ns, id), true)
    const blocked = deleteCustomRepoRole(ns, id, true)
    assert.equal(blocked.ok, false)

    removeRepoCollaborator(ns, 'r1', bob)
    assert.equal(isCustomRepoRoleAssigned(ns, id), false)
    const deleted = deleteCustomRepoRole(ns, id, false)
    assert.equal(deleted.ok, true)
  })

  it('manage_collaborators fine permission grants canManageRepoCollaborators', () => {
    const ns = 'tc-mgr-collab'
    createNamespaceAuthz(admin, ns, 'none', true)
    const created = createCustomRepoRole(ns, {
      name: 'CollabMgr',
      base: 'read',
      permissions: ['manage_collaborators'],
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    const u = mkUser('collab-mgr')
    setRepoCollaborator(ns, 'r1', u, created.role.id)
    assert.equal(canManageRepoCollaborators(u, ns, 'r1'), true)
    assert.equal(canManageRepoCollaborators(u, ns, 'other'), false)
  })

  it('deleteCustomRolesForNamespace clears roles with namespace', () => {
    const ns = 'tc-roles-cleanup'
    createNamespaceAuthz(admin, ns, 'none', true)
    createCustomNamespaceRole(ns, {
      name: 'X',
      permissions: ['view_audit'],
    })
    createCustomRepoRole(ns, {
      name: 'Y',
      base: 'read',
      permissions: [],
    })
    deleteCustomRolesForNamespace(ns)
    deleteNamespaceAuthz(ns)
    assert.equal(getNamespace(ns), null)
  })

  it('finePermissionForAction maps oxen actions', () => {
    assert.equal(finePermissionForAction('GET', 'other'), 'contents_read')
    assert.equal(finePermissionForAction('PUT', 'file.write'), 'contents_write')
    assert.equal(finePermissionForAction('POST', 'merge'), 'merge')
    assert.equal(finePermissionForAction('DELETE', 'branch.delete'), 'delete_branch')
    assert.equal(finePermissionForAction('DELETE', 'repo.delete'), 'repo_delete')
    assert.equal(finePermissionForAction('POST', 'workspace.create'), 'workspaces')
    assert.equal(finePermissionForAction('POST', 'repo.create'), null)
    assert.equal(finePermissionForAction('PATCH', 'mystery'), 'other_mutate')
  })
})

describe('audit ACL and path classification', () => {
  it('authorizeAuditQuery denies outsider and foreign namespace', () => {
    const ns = 'tc-audit-acl'
    createNamespaceAuthz(admin, ns, 'none', true)
    setNamespaceMember(ns, alice, 'owner')
    const outsider = mkUser('audit-outsider')
    writeInstancePermissions(outsider, [])
    const denied = authorizeAuditQuery(outsider, undefined)
    assert.equal(denied.allow, false)

    const other = authorizeAuditQuery(alice, 'not-alice-ns')
    assert.equal(other.allow, false)

    const scoped = authorizeAuditQuery(alice, ns)
    assert.equal(scoped.allow, true)
    assert.equal(scoped.forceNamespace, ns)
  })

  it('multi-namespace owner gets ownedOnly list', () => {
    const a = 'tc-audit-a'
    const b = 'tc-audit-b'
    createNamespaceAuthz(admin, a, 'none', true)
    createNamespaceAuthz(admin, b, 'none', true)
    const u = mkUser('multi-owner')
    setNamespaceMember(a, u, 'owner')
    setNamespaceMember(b, u, 'owner')
    // demote admin ownership for isolation is hard; alice-style: use fresh ns only owners
    const gate = authorizeAuditQuery(u, undefined)
    assert.equal(gate.allow, true)
    assert.ok(gate.ownedOnly?.includes(a))
    assert.ok(gate.ownedOnly?.includes(b))
  })

  it('classifyPath covers create, file, branch, merge, workspace, delete', () => {
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
})

describe('repo / namespace API decisions', () => {
  it('list repos in namespace denied for non-members (admin bypass)', () => {
    const ns = 'tc-list-ns'
    createNamespaceAuthz(admin, ns, 'none', true)
    const outsider = mkUser('list-outsider')
    const denied = authorizeApiRequest({
      user: outsider,
      via: 'session',
      method: 'GET',
      pathname: `/api/repos/${ns}`,
    })
    assert.equal(denied.allow, false)

    const bypass = authorizeApiRequest({
      user: admin,
      via: 'session',
      method: 'GET',
      pathname: `/api/repos/${ns}`,
    })
    // admin is Owner of ns from create — allow without needing bypass
    assert.equal(bypass.allow, true)
  })

  it('site admin bypass when not a member of listed namespace', () => {
    const ns = 'tc-list-bypass'
    createNamespaceAuthz(admin, ns, 'none', true)
    const admin2 = mkUser('list-admin2')
    addInstanceAdmin(admin, admin2)
    // remove any accidental membership — admin2 has none
    const d = authorizeApiRequest({
      user: admin2,
      via: 'session',
      method: 'GET',
      pathname: `/api/repos/${ns}`,
    })
    assert.equal(d.allow, true)
    assert.equal(d.siteAdminBypass, true)
  })

  it('namespace.create requires create_namespace or instance admin', () => {
    const u = mkUser('ns-create-deny')
    const ns = 'tc-ns-create-grant'
    createNamespaceAuthz(admin, ns, 'read', true)
    setNamespaceMember(ns, u, 'member')
    const denied = authorizeApiRequest({
      user: u,
      via: 'session',
      method: 'POST',
      pathname: '/api/namespaces',
    })
    assert.equal(denied.allow, false)

    const withPerm = mkUser('ns-create-ok')
    writeInstancePermissions(withPerm, ['create_namespace'])
    const allowed = authorizeApiRequest({
      user: withPerm,
      via: 'session',
      method: 'POST',
      pathname: '/api/namespaces',
    })
    assert.equal(allowed.allow, true)
  })

  it('removeRepoCollaborator clears outside collaborator access', () => {
    const ns = 'tc-rm-collab'
    createNamespaceAuthz(admin, ns, 'none', true)
    const u = mkUser('temp-collab')
    setRepoCollaborator(ns, 'only', u, 'write')
    assert.equal(hasRepoPermission(u, ns, 'only', 'write').ok, true)
    assert.equal(removeRepoCollaborator(ns, 'only', u), true)
    assert.equal(hasRepoPermission(u, ns, 'only', 'read').ok, false)
    assert.equal(isPendingUser(u), true)
  })

  it('PAT scopes on instance admin do not widen beyond maxRole', () => {
    const ns = 'tc-pat-admin'
    createNamespaceAuthz(admin, ns, 'none', true)
    const { token } = createPat(admin, 'capped', [
      { namespace: ns, repo: 'r1', maxRole: 'read' },
    ])
    const patUser = resolvePat(token)
    assert.ok(patUser)
    assert.equal(hasRepoPermission(patUser!, ns, 'r1', 'read').ok, true)
    assert.equal(hasRepoPermission(patUser!, ns, 'r1', 'write').ok, false)
  })

  it('updateNamespaceSettings basePermission affects members', () => {
    const ns = 'tc-base-patch'
    createNamespaceAuthz(admin, ns, 'none', true)
    const u = mkUser('base-patch-user')
    setNamespaceMember(ns, u, 'member')
    assert.equal(hasRepoPermission(u, ns, 'r', 'read').ok, false)
    updateNamespaceSettings(ns, { basePermission: 'read' })
    assert.equal(hasRepoPermission(u, ns, 'r', 'read').ok, true)
    assert.equal(hasRepoPermission(u, ns, 'r', 'write').ok, false)
  })
})
