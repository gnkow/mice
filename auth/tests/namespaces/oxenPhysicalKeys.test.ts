import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isPhysicalOxenKey,
  physicalCreateBody,
  rewriteNamespacePathToPhysical,
  rewriteOxenJsonToDisplay,
  rewriteRepoListPathToPhysical,
  rewriteReposApiPathToPhysical,
} from '../../src/packages/namespaces/lib/oxenPhysicalKeys.js'

const NS = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const REPO = '11111111-2222-4333-8444-555555555555'

describe('oxenPhysicalKeys', () => {
  it('detects UUID physical keys', () => {
    assert.equal(isPhysicalOxenKey(NS), true)
    assert.equal(isPhysicalOxenKey('demo'), false)
  })

  it('rewrites repo API paths to physical ids', () => {
    assert.equal(
      rewriteReposApiPathToPhysical('/api/repos/demo/assay/branches', {
        namespaceId: NS,
        repositoryId: REPO,
      }),
      `/api/repos/${NS}/${REPO}/branches`,
    )
    assert.equal(rewriteReposApiPathToPhysical('/api/repos', { namespaceId: NS, repositoryId: REPO }), '/api/repos')
  })

  it('rewrites list and namespace paths', () => {
    assert.equal(rewriteRepoListPathToPhysical('/api/repos/demo', NS), `/api/repos/${NS}`)
    assert.equal(
      rewriteNamespacePathToPhysical('/api/namespaces/demo', NS),
      `/api/namespaces/${NS}`,
    )
  })

  it('builds create bodies with physical keys', () => {
    assert.equal(
      physicalCreateBody(JSON.stringify({ namespace: 'demo', name: 'assay', extra: 1 }), {
        namespaceId: NS,
        repositoryId: REPO,
      }),
      JSON.stringify({ namespace: NS, name: REPO, extra: 1 }),
    )
  })

  it('strips Mice-only initial_commit_message and branches from create bodies', () => {
    assert.equal(
      physicalCreateBody(
        JSON.stringify({
          namespace: 'demo',
          name: 'assay',
          initial_commit_message: 'Bootstrapped',
          branches: [{ name: 'main', default: true, validated: true }],
        }),
        { namespaceId: NS, repositoryId: REPO },
      ),
      JSON.stringify({ namespace: NS, name: REPO }),
    )
  })

  it('parses create branch plans and forces a single default', async () => {
    const { createBranchPlanFromBody, createBranchesOptionFromBody } = await import(
      '../../src/packages/namespaces/lib/oxenPhysicalKeys.js'
    )
    assert.deepEqual(
      createBranchPlanFromBody({
        branches: [
          { name: 'main', default: true, validated: true },
          { name: 'dev', default: true, validated: false },
        ],
      }),
      [
        { name: 'main', isDefault: true, validated: true },
        { name: 'dev', isDefault: false, validated: false },
      ],
    )
    assert.deepEqual(createBranchesOptionFromBody({}), { kind: 'omit' })
    assert.deepEqual(createBranchesOptionFromBody({ branches: [] }), { kind: 'bare' })
    assert.equal(
      createBranchesOptionFromBody({
        branches: [{ name: 'main', default: true, validated: true }],
      }).kind,
      'plan',
    )
  })

  it('prefers explicit branches from signature over raw body', async () => {
    const { miceCreateOptionsFromBodies } = await import(
      '../../src/packages/namespaces/lib/oxenPhysicalKeys.js'
    )
    assert.equal(
      miceCreateOptionsFromBodies({ branches: [] }, JSON.stringify({ namespace: 'n', name: 'r' }))
        .branches.kind,
      'bare',
    )
    assert.equal(
      miceCreateOptionsFromBodies({}, JSON.stringify({ branches: [] })).branches.kind,
      'bare',
    )
    assert.equal(
      miceCreateOptionsFromBodies(
        { branches: [{ name: 'dev', default: true }] },
        JSON.stringify({ branches: [] }),
      ).branches.kind,
      'plan',
    )
  })

  it('rewrites oxen JSON catalogs and repository objects to display names', () => {
    const resolveNamespace = (id: string) => (id === NS ? 'demo' : null)
    const resolveRepo = (namespaceId: string, repositoryId: string) =>
      namespaceId === NS && repositoryId === REPO
        ? { namespace: 'demo', repo: 'assay' }
        : null

    const list = rewriteOxenJsonToDisplay(
      JSON.stringify({
        repositories: [{ namespace: NS, name: REPO, size: 1 }],
      }),
      resolveNamespace,
      resolveRepo,
    )
    assert.deepEqual(JSON.parse(list), {
      repositories: [{ namespace: 'demo', name: 'assay', size: 1 }],
    })

    const catalog = rewriteOxenJsonToDisplay(
      JSON.stringify({ namespaces: [{ namespace: NS }] }),
      resolveNamespace,
      resolveRepo,
    )
    assert.deepEqual(JSON.parse(catalog), { namespaces: [{ namespace: 'demo' }] })

    const created = rewriteOxenJsonToDisplay(
      JSON.stringify({ repository: { namespace: NS, name: REPO }, repository_id: REPO }),
      resolveNamespace,
      resolveRepo,
    )
    assert.deepEqual(JSON.parse(created), {
      repository: { namespace: 'demo', name: 'assay' },
      repository_id: REPO,
    })
  })
})
