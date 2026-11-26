import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { EMPTY_AUDIT_CHANGE, isEmptyAuditChange, NoChangeError, requireAuditChange, type AuditChange } from '../../src/packages/audit/lib/auditChange.js'
import {
  AUDIT_CHANGE_CAPTURE_GAPS,
  AUDIT_CHANGE_KIND,
  AUDIT_CHANGE_KINDS,
  assertCatalogueComplete,
  auditActionsOfKind,
  auditChangeKind,
} from '../../src/packages/audit/lib/auditChangeCatalogue.js'
import { knownAuditActions } from '../../src/packages/audit/lib/auditLabels.js'
import { proxyMutationChange, type ProxyChangeInput } from '../../src/packages/proxy/lib/proxyChange.js'

type Snap = Record<string, unknown>

/** A worked example: how the writer builds the change of one mutation action. */
type Fixture =
  | { via: 'require'; before: Snap | null; after: Snap | null }
  | { via: 'proxy'; input: Omit<ProxyChangeInput, 'action' | 'upstreamOk'> }

const create = (after: Snap): Fixture => ({ via: 'require', before: null, after })
const remove = (before: Snap): Fixture => ({ via: 'require', before, after: null })
const update = (before: Snap, after: Snap): Fixture => ({ via: 'require', before, after })
const proxy = (input: Extract<Fixture, { via: 'proxy' }>['input']): Fixture => ({ via: 'proxy', input })

const branchMove = proxy({ branch: 'main', base: 'c1', head: 'c2' })
const sessionMove = update({ status: 'ready' }, { status: 'stopped' })
const roleMove = update({ role: null }, { role: 'editor' })
const settingsMove = update({ enabled: false }, { enabled: true })

/** One worked before→after example per `mutation` action. The test fails when one is missing. */
const MUTATION_FIXTURES: Record<string, Fixture> = {
  // Proxied dataset mutations: branch head base→head (+ file hashes)
  'file.write': proxy({ branch: 'main', base: 'c1', head: 'c2', fileDeltas: [{ path: 'a.csv', before: 'h1', after: 'h2' }] }),
  'file.delete': proxy({ branch: 'main', base: 'c1', head: 'c2', fileDeltas: [{ path: 'a.csv', before: 'h1', after: null }] }),
  'branch.create': proxy({ branch: 'dev', head: 'c9' }),
  'branch.update': branchMove,
  'branch.delete': proxy({ branch: 'old', base: 'c1' }),
  'commit.publish': branchMove,
  merge: branchMove,
  'workspace.commit': branchMove,
  'workspace.merge': branchMove,
  // Proxied create / delete / settings
  'repo.create': proxy({ namespace: 'ns', repo: 'r', repositoryId: 'id-1' }),
  'repo.delete': proxy({ namespace: 'ns', repo: 'r', repositoryId: 'id-1' }),
  'repo.metadata': proxy({ metadataBefore: { description: 'old' }, metadataAfter: { description: 'new' } }),
  'namespace.create': proxy({ namespace: 'ns' }),
  'workspace.create': proxy({ namespace: 'ns', repo: 'r', workspaceId: 'w1' }),
  'workspace.delete': proxy({ namespace: 'ns', repo: 'r', workspaceId: 'w1' }),
  // Repositories
  'repo.rename': update({ name: 'old' }, { name: 'new' }),
  'repo.settings.update': update({ description: 'old' }, { description: 'new' }),
  'repo.collaborator.set': create({ user: 'u1', role: 'editor' }),
  'repo.collaborator.remove': remove({ user: 'u1', role: 'editor' }),
  'approver.grant': create({ user: 'u1', approver: true }),
  'validated_branch.mark': update(
    { validated_branches: ['main'] },
    { validated_branches: ['feature', 'main'] },
  ),
  'validated_branch.unmark': update(
    { validated_branches: ['feature', 'main'] },
    { validated_branches: ['main'] },
  ),
  'approver.revoke': remove({ user: 'u1', approver: true }),
  // Signatures
  'esign.created': create({ signature_id: 's1', status: 'valid' }),
  'esign.execute': create({ signature_id: 's1', meaning: 'Approved' }),
  'esign.revoked': update({ status: 'valid' }, { status: 'revoked' }),
  'esign.revocation_reverted': update({ status: 'revoked' }, { status: 'valid' }),
  // Merge requests
  'merge_request.open': create({ id: 'mr1', status: 'open' }),
  'merge_request.resync': update({ source_tip: 'c1' }, { source_tip: 'c2' }),
  'merge_request.cancel': update({ status: 'open' }, { status: 'cancelled' }),
  'merge_request.reopen': update({ status: 'cancelled' }, { status: 'open' }),
  'merge_request.reject': update({ status: 'open' }, { status: 'rejected' }),
  'merge_request.reject_reverted': update({ status: 'rejected' }, { status: 'open' }),
  'merge_request.complete': update({ status: 'open' }, { status: 'merged' }),
  // Workspaces, leases, checkout store (system events: see systemAuditChange.test.ts)
  'workspace.retry': update({ status: 'failed', retry_count: 1 }, { status: 'preparing', retry_count: 2 }),
  'workspace.lease.acquire': create({ lease_id: 'l1', workspace_id: 'w1', mode: 'write' }),
  'workspace.lease.release': remove({ lease_id: 'l1', workspace_id: 'w1', mode: 'write' }),
  'workspace.lease.force_release': remove({ lease_id: 'l1', workspace_id: 'w1', mode: 'write' }),
  'checkout.build': create({ checkout: 'ns/r/c1', files: 3 }),
  'checkout.evict': remove({ checkout: 'ns/r/c1', files: 3 }),
  'checkout.corrupt': update({ 'checkout.ns/r/c1': 'ready' }, { 'checkout.ns/r/c1': 'corrupt' }),
  'store.gc': update({ blob_count: 10, store_bytes: 100 }, { blob_count: 8, store_bytes: 60 }),
  // Jobs, metadata
  'job.submit': create({ job_id: 'j1', status: 'queued' }),
  'job.complete': update({ status: 'running' }, { status: 'succeeded' }),
  'job.fail': update({ status: 'running' }, { status: 'failed' }),
  'job.cancel': update({ status: 'running' }, { status: 'cancelled' }),
  'job.sync': update({ metadata: null }, { metadata: 'synced' }),
  'job.publish': update({ published: false }, { published: true }),
  'job.result_commit': update({ result_commit: null }, { result_commit: 'c3' }),
  'meta.set': update({ title: 'a' }, { title: 'b' }),
  'meta.delete': remove({ title: 'a' }),
  // Desktop sessions
  'session.create': create({ session_id: 's1', status: 'creating' }),
  'session.ready': update({ status: 'creating' }, { status: 'ready' }),
  'session.fail': update({ status: 'creating' }, { status: 'failed' }),
  'session.connect': update({ status: 'ready' }, { status: 'connected' }),
  'session.disconnect': update({ status: 'connected' }, { status: 'ready' }),
  'session.stop': sessionMove,
  'session.retry': update({ status: 'failed' }, { status: 'creating' }),
  'session.mounts.update': update({ mounts: ['a'] }, { mounts: ['a', 'b'] }),
  'session.remount': update({ workspace: 'w1' }, { workspace: 'w2' }),
  'session.destroy': update({ status: 'stopped' }, { status: 'destroyed' }),
  'session.sync': update({ files_synced: 0 }, { files_synced: 4 }),
  // Namespaces and roles
  'namespace.settings.update': settingsMove,
  'namespace.delete': remove({ namespace: 'ns' }),
  'namespace.member.set': create({ user: 'u1', role: 'member' }),
  'namespace.member.remove': remove({ user: 'u1', role: 'member' }),
  'custom-role.namespace.create': create({ role: 'r1', permissions: ['read'] }),
  'custom-role.namespace.update': update({ permissions: ['read'] }, { permissions: ['read', 'write'] }),
  'custom-role.namespace.delete': remove({ role: 'r1', permissions: ['read'] }),
  'custom-role.repo.create': create({ role: 'r1', permissions: ['read'] }),
  'custom-role.repo.update': update({ permissions: ['read'] }, { permissions: ['read', 'write'] }),
  'custom-role.repo.delete': remove({ role: 'r1', permissions: ['read'] }),
  // Access
  'access-request.submit': create({ request_id: 'a1', status: 'pending' }),
  'access-request.approve': update({ status: 'pending' }, { status: 'approved' }),
  'access-request.deny': update({ status: 'pending' }, { status: 'denied' }),
  'role.assign': roleMove,
  'role.revoke': update({ role: 'editor' }, { role: null }),
  'permission.grant': update({ permissions: [] }, { permissions: ['p1'] }),
  'permission.revoke': update({ permissions: ['p1'] }, { permissions: [] }),
  'access.grant.role': roleMove,
  'access.grant.permissions': update({ permissions: [] }, { permissions: ['p1'] }),
  'training.update': update({ trained: false }, { trained: true }),
  'access-review.sign': create({ review_id: 'rv1', signed: true }),
  // Instance
  'instance.settings.update': settingsMove,
  'instance.admin.add': create({ user: 'u1', admin: true }),
  'instance.admin.remove': remove({ user: 'u1', admin: true }),
  'instance.permissions.update': update({ permissions: [] }, { permissions: ['p1'] }),
  'instance.permissions.expire': update({ permissions: ['p1'] }, { permissions: [] }),
  'announcement.create': create({ id: 'an1', title: 'Hello' }),
  'announcement.update': update({ title: 'Hello' }, { title: 'Hello again' }),
  'announcement.delete': remove({ id: 'an1', title: 'Hello' }),
  // Tokens, devices, sessions
  'token.create': create({ token_id: 't1' }),
  'token.refresh': update({ expires_at: 1 }, { expires_at: 2 }),
  'token.revoke': remove({ token_id: 't1' }),
  'device.approve': update({ status: 'pending' }, { status: 'approved' }),
  'device.deny': update({ status: 'pending' }, { status: 'denied' }),
  'device.redeem': update({ status: 'approved' }, { status: 'redeemed' }),
  'session.revoke': remove({ session_id: 's1' }),
  'session.evict': remove({ session_id: 's1' }),
  'session.role_change': roleMove,
  // Account lifecycle
  'auth.suspend.request': create({ request_id: 'q1', status: 'pending' }),
  'auth.suspend.confirm': update({ suspended: false }, { suspended: true }),
  'auth.suspend.self': update({ suspended: false }, { suspended: true }),
  'auth.reenable.automatic': update({ suspended: true }, { suspended: false }),
  'auth.reenable.confirmed': update({ suspended: true }, { suspended: false }),
  // Audit, lineage
  'lineage.rebuild': update({ ops: 1 }, { ops: 5 }),
  'audit.break.acknowledge': update({ acknowledged: false }, { acknowledged: true }),
  'audit.visibility.update': update({ visible: ['a'] }, { visible: ['a', 'b'] }),
  // Admin, system, keys
  'admin.revoke_all': remove({ session_count: 3 }),
  'admin.suspend_initiated': create({ request_id: 'q1', status: 'pending' }),
  'admin.suspend_confirmed': update({ suspended: false }, { suspended: true }),
  'admin.mice_suspension.set': update({ suspended: false }, { suspended: true }),
  'admin.mice_suspension.lift': update({ suspended: true }, { suspended: false }),
  'idp_baseline.established': create({ baseline: 'b1' }),
  'seal_key.rotated': update({ current: 'k1' }, { current: 'k2' }),
  'seal_key.emergency_rotation': update({ current: 'k1' }, { current: 'k2' }),
  'system.regulated_config.change': update({ mode: 'off' }, { mode: 'on' }),
}

function build(action: string, f: Fixture): AuditChange {
  return f.via === 'require'
    ? requireAuditChange(f.before, f.after)
    : proxyMutationChange({ action, upstreamOk: true, ...f.input })
}

describe('audit change catalogue', () => {
  it('is complete', () => {
    assertCatalogueComplete()
  })

  it('classifies every known audit action', () => {
    for (const { value } of knownAuditActions()) {
      assert.notEqual(auditChangeKind(value), undefined, `${value} has no change kind`)
    }
  })

  it('uses only known kinds', () => {
    for (const [action, kind] of Object.entries(AUDIT_CHANGE_KIND)) {
      assert.ok(AUDIT_CHANGE_KINDS.includes(kind), `${action} has unknown kind ${kind}`)
    }
    assert.equal(auditChangeKind('definitely.not.an.action'), undefined)
    assert.equal(auditChangeKind('constructor'), undefined)
  })

  it('classifies the extra writers outside the label catalogue', () => {
    for (const action of [
      'repo.rename',
      'repo.settings.update',
      'merge_request.complete',
      'system.integrity_check',
      'admin.revoke_all',
      'seal_key.rotated',
      'seal_key.emergency_rotation',
    ]) {
      assert.notEqual(auditChangeKind(action), undefined, action)
    }
    assert.equal(auditChangeKind('seal_key.rotated'), 'mutation')
    assert.equal(auditChangeKind('system.integrity_check'), 'non_mutation')
  })

  it('classifies transport and staging explicitly, never as silent mutations', () => {
    assert.equal(auditChangeKind('commit.upload'), 'transport')
    assert.equal(auditChangeKind('workspace.file.write'), 'staging')
    assert.equal(auditChangeKind('workspace.file.delete'), 'staging')
    assert.deepEqual(auditActionsOfKind('transport'), ['commit.upload'])
    assert.deepEqual(auditActionsOfKind('staging'), ['workspace.file.write', 'workspace.file.delete'])
    const mutations = new Set(auditActionsOfKind('mutation'))
    for (const action of ['commit.upload', 'workspace.file.write', 'workspace.file.delete']) {
      assert.equal(mutations.has(action), false, `${action} must not be a mutation`)
    }
  })

  it('pins the mutations that still record an empty change (capture gaps)', () => {
    assert.deepEqual([...AUDIT_CHANGE_CAPTURE_GAPS], [])
  })

  describe('mutation worked examples', () => {
    const mutations = auditActionsOfKind('mutation')

    it('has a fixture for every mutation and none for other kinds', () => {
      assert.deepEqual(Object.keys(MUTATION_FIXTURES).sort(), [...mutations].sort())
    })

    for (const action of mutations) {
      it(`${action}: non-empty before→after`, () => {
        const change = build(action, MUTATION_FIXTURES[action]!)
        assert.equal(isEmptyAuditChange(change), false, `${action} produced an empty change`)
        assert.ok(change.before !== null || change.after !== null)
      })
    }

    it('refuses a no-op update with NoChangeError', () => {
      assert.throws(() => requireAuditChange({ status: 'ready' }, { status: 'ready' }), NoChangeError)
      assert.throws(() => requireAuditChange(null, null), NoChangeError)
    })

    it('records only the differing keys of an update', () => {
      assert.deepEqual(requireAuditChange({ a: 1, b: 2 }, { a: 1, b: 3 }), { before: { b: 2 }, after: { b: 3 } })
    })
  })

  describe('proxy coverage', () => {
    it('records workspace.file.delete (was missing: fell through to EMPTY)', () => {
      const change = proxyMutationChange({
        action: 'workspace.file.delete',
        upstreamOk: true,
        fileDeltas: [{ path: 'a.csv', before: 'h1', after: null }],
      })
      assert.deepEqual(change, { before: { 'file.a.csv': 'h1' }, after: { 'file.a.csv': null } })
    })

    it('records workspace.file.write from file deltas', () => {
      const change = proxyMutationChange({
        action: 'workspace.file.write',
        upstreamOk: true,
        fileDeltas: [{ path: 'a.csv', before: null, after: 'h2' }],
      })
      assert.deepEqual(change, { before: { 'file.a.csv': null }, after: { 'file.a.csv': 'h2' } })
    })

    it('never leaves an answered staging request empty', () => {
      for (const action of ['workspace.file.write', 'workspace.file.delete']) {
        for (const input of [{}, { paths: ['x.csv'] }, { workspaceId: 'w1' }]) {
          const change = proxyMutationChange({ action, upstreamOk: true, ...input })
          assert.equal(isEmptyAuditChange(change), false, `${action} ${JSON.stringify(input)}`)
        }
      }
    })

    it('leaves transport and refused requests empty by design', () => {
      assert.deepEqual(proxyMutationChange({ action: 'commit.upload', upstreamOk: true }), EMPTY_AUDIT_CHANGE)
      for (const action of ['workspace.file.write', 'workspace.file.delete', 'repo.metadata']) {
        assert.deepEqual(proxyMutationChange({ action, upstreamOk: false }), EMPTY_AUDIT_CHANGE)
      }
    })
  })
})
