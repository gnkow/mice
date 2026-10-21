import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createServer } from 'node:http'
import { buildPatch, parseMetaArgs, resolveEntityId, cmdMeta } from './meta.mjs'

const ctx = () => ({ namespace: 'acme', repo: 'data', branch: 'dev' })

describe('parseMetaArgs / buildPatch', () => {
  it('parses explicit path scopes', () => {
    const p = parseMetaArgs(['file', 'a.csv', '--scope', 'branch', '--revision', 'feature/a'])
    assert.equal(p.flags.scope, 'branch')
    assert.equal(p.flags.revision, 'feature/a')
  })
  it('collects repeated and comma separated tags and labels', () => {
    const p = parseMetaArgs([
      'repo', '--tag', 'a,#b', '--tag=c', '--label', 'env=prod', '--label', 'url=x=y',
      '--untag', 'old', '--unlabel', 'gone',
    ])
    assert.deepEqual(p._, ['repo'])
    assert.deepEqual(buildPatch(p), {
      tags: ['a', 'b', 'c'],
      labels: { env: 'prod', url: 'x=y', gone: null },
    })
  })

  describe('metadata writes', () => {
    it('preserves unrelated items, uses scope and revision, and deletes entries', async () => {
      const writes = []
      const server = createServer(async (req, res) => {
        res.setHeader('content-type', 'application/json')
        if (req.method === 'GET') {
          const url = new URL(req.url, 'http://localhost')
          assert.equal(url.searchParams.get('scope'), 'branch')
          assert.equal(url.searchParams.get('revision'), 'main')
          res.end(JSON.stringify({ revision: 7, version: 'record-version', own: { tags: ['keep', 'remove'], labels: { keep: 'yes' } } }))
        } else {
          let body = ''
          for await (const chunk of req) body += chunk
          writes.push(JSON.parse(body))
          res.end(JSON.stringify({ ok: true, revision: 8 }))
        }
      })
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
      try {
        await cmdMeta(['set', 'file', 'file.csv', '--scope', 'branch', '--revision', 'main', '--tag', 'new', '--untag', 'remove', '--label', 'owner=team', '--unlabel', 'gone'], {
          auth: () => ({ remote: `http://127.0.0.1:${server.address().port}`, token: 'test' }),
          ctx,
          usage: () => { throw new Error('Unexpected usage') },
        })
        assert.equal(writes.length, 1)
        assert.equal(writes[0].ifRevision, 7)
        assert.equal(writes[0].ifVersion, 'record-version')
        assert.deepEqual(writes[0].ref.scope, { kind: 'branch', id: 'main' })
        assert.deepEqual(writes[0].tags, ['keep', 'new'])
        assert.equal(writes[0].removeTags, undefined)
        assert.deepEqual(writes[0].labels, { owner: 'team', gone: null })
        assert.equal(writes[0].unset, undefined)
      } finally {
        await new Promise(resolve => server.close(resolve))
      }
    })
  })

  it('rejects removed inheritance options', () => {
    for (const flag of ['--inherit', '--no-inherit', '--propagation', '--reset-tag', '--reset-label']) {
      assert.throws(() => parseMetaArgs([flag]), /Unknown option/)
    }
  })

  it('rejects bad input', () => {
    assert.throws(() => buildPatch(parseMetaArgs(['--label', 'novalue'])), /key=value/)
    assert.throws(() => buildPatch(parseMetaArgs(['--tag', 'a', '--untag', 'a'])), /both/)
    assert.throws(() => buildPatch(parseMetaArgs(['--label', 'k=v', '--unlabel', 'k'])), /both/)
    assert.throws(() => parseMetaArgs(['--bogus']), /Unknown option/)
    assert.throws(() => parseMetaArgs(['--tag']), /Missing value/)
  })
})

describe('resolveEntityId', () => {
  it('fills in the current clone', () => {
    assert.equal(resolveEntityId('namespace', undefined, ctx), 'acme')
    assert.equal(resolveEntityId('repo', undefined, ctx), 'acme/data')
    assert.equal(resolveEntityId('branch', undefined, ctx), 'acme/data@dev')
    assert.equal(resolveEntityId('branch', 'main', ctx), 'acme/data@main')
    assert.equal(resolveEntityId('commit', 'abc123', ctx), 'acme/data#abc123')
    assert.equal(resolveEntityId('workspace', 'w1', ctx), 'acme/data!w1')
    assert.equal(resolveEntityId('file', 'a/b.csv', ctx), 'acme/data:a/b.csv')
    assert.equal(resolveEntityId('directory', 'a/b', ctx), 'acme/data:a/b/')
  })

  it('keeps full ids and plain ids', () => {
    assert.equal(resolveEntityId('file', 'o/r:x.csv', () => { throw new Error('no ctx') }), 'o/r:x.csv')
    assert.equal(resolveEntityId('job', 'j1', ctx), 'j1')
    assert.throws(() => resolveEntityId('job', undefined, ctx), /required/)
    assert.throws(() => resolveEntityId('widget', 'x', ctx), /Unknown entity type/)
    assert.throws(() => resolveEntityId('file', undefined, ctx), /required/)
  })

  it('requires a repo for repo-scoped types', () => {
    const noRepo = () => ({ namespace: 'acme', repo: '' })
    assert.throws(() => resolveEntityId('repo', undefined, noRepo), /repo/)
    assert.equal(resolveEntityId('namespace', undefined, noRepo), 'acme')
  })
})

describe('creation-time meta', () => {
  it('extracts --tag/--label and stops at --', async () => {
    const { extractCreateMeta } = await import('./meta.mjs')
    const r = extractCreateMeta(['commit', '-m', 'x', '--tag', 'a', '--label=k=v', '--', '--tag', 'keep'])
    assert.deepEqual(r.args, ['commit', '-m', 'x', '--', '--tag', 'keep'])
    assert.deepEqual(r.patch, { tags: ['a'], labels: { k: 'v' } })
    assert.equal(extractCreateMeta(['commit', '-m', 'x']).patch, null)
  })

  it('detects entity-creating commands', async () => {
    const { detectCreation } = await import('./meta.mjs')
    assert.deepEqual(detectCreation(['commit', '-m', 'x']), { kind: 'commit' })
    assert.deepEqual(detectCreation(['branch', 'dev']), { kind: 'branch', name: 'dev' })
    assert.deepEqual(detectCreation(['checkout', '-b', 'dev']), { kind: 'branch', name: 'dev' })
    assert.deepEqual(detectCreation(['create-remote', 'a/b']), { kind: 'repo', name: 'a/b' })
    assert.equal(detectCreation(['branch', '-d', 'dev']), null)
    assert.equal(detectCreation(['push']), null)
  })
})
