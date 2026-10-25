import { expect } from '@playwright/test'
import { cleanTest as base } from '../fixtures'
import { putFile, uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

const BASE_URL = process.env.MICE_BASE_URL ?? 'http://localhost:5173'
const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'

const test = base

async function sessionLogin(
  page: import('@playwright/test').Page,
  identity?: { name?: string; email?: string; sub?: string },
) {
  await mintSession(page, {
    name: identity?.name,
    email: identity?.email,
    sub: identity?.sub,
    iss: 'mice-e2e',
  })
}

async function fetchLineage(
  page: import('@playwright/test').Page,
  query: Record<string, string>,
) {
  const params = new URLSearchParams(query)
  const res = await page.request.get(
    `${AUTH_URL}/auth/lineage?${params.toString()}`,
  )
  return { status: res.status(), body: await res.json() }
}

test.describe('file lineage (PLAT-TRACE)', () => {
  test('TC-TRACE-01: upload via BFF creates upload lineage op', async ({
    page,
  }) => {
    const sub = uniqueId('trace-sub')
    await sessionLogin(page, {
      name: 'Trace Author',
      email: 'trace@author.test',
      sub,
    })

    const ns = uniqueId('trace-ns')
    const repo = 'repo'
    const create = await page.request.post(`${AUTH_URL}/api/repos`, {
      data: { namespace: ns, name: repo },
    })
    expect(create.ok()).toBeTruthy()

    const put = await page.request.put(
      `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}/file/main/readme.txt`,
      {
        multipart: {
          file: {
            name: 'readme.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('trace seed\n'),
          },
          message: 'trace upload',
          name: 'Forged',
          email: 'forged@evil.test',
        },
      },
    )
    expect(put.ok()).toBeTruthy()

    const { status, body } = await fetchLineage(page, {
      namespace: ns,
      repo,
      path: 'readme.txt',
      limit: '50',
    })
    expect(status).toBe(200)
    const upload = body.operations.find(
      (o: { kind: string; source: string }) =>
        o.kind === 'upload' && o.source === 'explicit',
    )
    expect(upload).toBeTruthy()
    expect(upload.inputs).toEqual([])
    expect(upload.outputs[0]?.path).toBe('readme.txt')
    expect(upload.actor?.sub).toBe(sub)
    expect(upload.confidence).toBe('high')
  })

  test('TC-TRACE-02: overwrite via BFF creates explicit edit op', async ({
    page,
  }) => {
    const sub = uniqueId('trace-edit')
    await sessionLogin(page, {
      name: 'Trace Edit',
      email: 'trace-edit@author.test',
      sub,
    })

    const ns = uniqueId('trace-edit-ns')
    const repo = 'repo'
    expect(
      (
        await page.request.post(`${AUTH_URL}/api/repos`, {
          data: { namespace: ns, name: repo },
        })
      ).ok(),
    ).toBeTruthy()

    expect(
      (
        await page.request.put(
          `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}/file/main/note.txt`,
          {
            multipart: {
              file: {
                name: 'note.txt',
                mimeType: 'text/plain',
                buffer: Buffer.from('version one\n'),
              },
              message: 'first write',
            },
          },
        )
      ).ok(),
    ).toBeTruthy()

    const edit = await page.request.put(
      `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}/file/main/note.txt`,
      {
        multipart: {
          file: {
            name: 'note.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('version two\n'),
          },
          message: 'second write',
        },
      },
    )
    expect(edit.ok()).toBeTruthy()

    const { status, body } = await fetchLineage(page, {
      namespace: ns,
      repo,
      path: 'note.txt',
      direction: 'both',
      limit: '50',
    })
    expect(status).toBe(200)
    const upload = body.operations.find(
      (o: { kind: string; source: string }) =>
        o.kind === 'upload' && o.source === 'explicit',
    )
    const editOp = body.operations.find(
      (o: { kind: string; source: string }) =>
        o.kind === 'edit' && o.source === 'explicit',
    )
    expect(upload).toBeTruthy()
    expect(editOp).toBeTruthy()
    expect(editOp.inputs).toHaveLength(1)
    expect(editOp.outputs).toHaveLength(1)
    expect(editOp.inputs[0]?.path).toBe('note.txt')
    expect(editOp.outputs[0]?.path).toBe('note.txt')
    expect(editOp.actor?.sub).toBe(sub)
    expect(editOp.confidence).toBe('high')
  })

  test('TC-TRACE-03a: same-folder PATCH creates rename op', async ({
    page,
  }) => {
    await sessionLogin(page, {
      name: 'Trace Rename',
      email: 'trace-rename@author.test',
      sub: uniqueId('trace-rename'),
    })

    const ns = uniqueId('trace-ren-ns')
    const repo = 'repo'
    expect(
      (
        await page.request.post(`${AUTH_URL}/api/repos`, {
          data: { namespace: ns, name: repo },
        })
      ).ok(),
    ).toBeTruthy()

    expect(
      (
        await page.request.put(
          `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}/file/main/old.txt`,
          {
            multipart: {
              file: {
                name: 'old.txt',
                mimeType: 'text/plain',
                buffer: Buffer.from('rename me\n'),
              },
              message: 'seed',
            },
          },
        )
      ).ok(),
    ).toBeTruthy()

    const move = await page.request.patch(
      `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}/file/main/old.txt`,
      {
        data: { new_path: 'new.txt', message: 'renamed' },
      },
    )
    expect(move.ok()).toBeTruthy()

    const { status, body } = await fetchLineage(page, {
      namespace: ns,
      repo,
      path: 'new.txt',
      direction: 'both',
    })
    expect(status).toBe(200)
    const op = body.operations.find(
      (o: { kind: string; source: string }) =>
        o.kind === 'rename' && o.source === 'explicit',
    )
    expect(op).toBeTruthy()
    expect(op.inputs[0]?.path).toBe('old.txt')
    expect(op.outputs[0]?.path).toBe('new.txt')
    expect(op.confidence).toBe('high')
  })

  test('TC-TRACE-03b: cross-folder PATCH creates move op', async ({
    page,
  }) => {
    await sessionLogin(page, {
      name: 'Trace Move',
      email: 'trace-move@author.test',
      sub: uniqueId('trace-move'),
    })

    const ns = uniqueId('trace-mv-ns')
    const repo = 'repo'
    expect(
      (
        await page.request.post(`${AUTH_URL}/api/repos`, {
          data: { namespace: ns, name: repo },
        })
      ).ok(),
    ).toBeTruthy()

    expect(
      (
        await page.request.put(
          `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}/file/main/old.txt`,
          {
            multipart: {
              file: {
                name: 'old.txt',
                mimeType: 'text/plain',
                buffer: Buffer.from('move me\n'),
              },
              message: 'seed',
            },
          },
        )
      ).ok(),
    ).toBeTruthy()

    const move = await page.request.patch(
      `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}/file/main/old.txt`,
      {
        data: { new_path: 'archive/old.txt', message: 'moved' },
      },
    )
    expect(move.ok()).toBeTruthy()

    const { status, body } = await fetchLineage(page, {
      namespace: ns,
      repo,
      path: 'archive/old.txt',
      direction: 'both',
    })
    expect(status).toBe(200)
    const op = body.operations.find(
      (o: { kind: string; source: string }) =>
        o.kind === 'move' && o.source === 'explicit',
    )
    expect(op).toBeTruthy()
    expect(op.inputs[0]?.path).toBe('old.txt')
    expect(op.outputs[0]?.path).toBe('archive/old.txt')
  })

  test('TC-TRACE-04: delete creates delete op with no outputs', async ({
    page,
  }) => {
    await sessionLogin(page, {
      name: 'Trace Del',
      email: 'trace-del@author.test',
      sub: uniqueId('trace-del'),
    })

    const ns = uniqueId('trace-del-ns')
    const repo = 'repo'
    expect(
      (
        await page.request.post(`${AUTH_URL}/api/repos`, {
          data: { namespace: ns, name: repo },
        })
      ).ok(),
    ).toBeTruthy()

    expect(
      (
        await page.request.put(
          `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}/file/main/gone.txt`,
          {
            multipart: {
              file: {
                name: 'gone.txt',
                mimeType: 'text/plain',
                buffer: Buffer.from('bye\n'),
              },
              message: 'seed',
            },
          },
        )
      ).ok(),
    ).toBeTruthy()

    const del = await page.request.delete(
      `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}/file/main/gone.txt`,
      {
        multipart: {
          message: 'delete it',
        },
      },
    )
    expect(del.ok()).toBeTruthy()

    const { status, body } = await fetchLineage(page, {
      namespace: ns,
      repo,
      path: 'gone.txt',
    })
    expect(status).toBe(200)
    const op = body.operations.find(
      (o: { kind: string }) => o.kind === 'delete',
    )
    expect(op).toBeTruthy()
    expect(op.outputs).toEqual([])
    expect(op.inputs[0]?.path).toBe('gone.txt')
  })

  test('TC-TRACE-05: copy_from via BFF creates copy lineage op', async ({
    page,
  }) => {
    const sub = uniqueId('trace-copy')
    await sessionLogin(page, {
      name: 'Trace Copy',
      email: 'trace-copy@author.test',
      sub,
    })

    const ns = uniqueId('trace-cp-ns')
    const repo = 'repo'
    expect(
      (
        await page.request.post(`${AUTH_URL}/api/repos`, {
          data: { namespace: ns, name: repo },
        })
      ).ok(),
    ).toBeTruthy()

    expect(
      (
        await page.request.put(
          `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}/file/main/data/report.csv`,
          {
            multipart: {
              file: {
                name: 'report.csv',
                mimeType: 'text/csv',
                buffer: Buffer.from('a,b\n1,2\n'),
              },
              message: 'seed csv',
            },
          },
        )
      ).ok(),
    ).toBeTruthy()

    const copy = await page.request.put(
      `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}/file/main/archive/report.csv`,
      {
        multipart: {
          file: {
            name: 'report.csv',
            mimeType: 'text/csv',
            buffer: Buffer.from('a,b\n1,2\n'),
          },
          message: 'copy csv',
          copy_from: 'data/report.csv',
        },
      },
    )
    expect(copy.ok()).toBeTruthy()

    const { status, body } = await fetchLineage(page, {
      namespace: ns,
      repo,
      path: 'archive/report.csv',
      direction: 'both',
      limit: '50',
    })
    expect(status).toBe(200)
    const op = body.operations.find(
      (o: { kind: string; source: string }) =>
        o.kind === 'copy' && o.source === 'explicit',
    )
    expect(op).toBeTruthy()
    expect(op.inputs[0]?.path).toBe('data/report.csv')
    expect(op.outputs[0]?.path).toBe('archive/report.csv')
    expect(op.actor?.sub).toBe(sub)
    expect(op.confidence).toBe('high')
  })

  test('TC-TRACE-06: restore_from via BFF creates restore lineage op', async ({
    page,
  }) => {
    const sub = uniqueId('trace-rst')
    await sessionLogin(page, {
      name: 'Trace Restore',
      email: 'trace-rst@author.test',
      sub,
    })

    const ns = uniqueId('trace-rst-ns')
    const repo = 'repo'
    expect(
      (
        await page.request.post(`${AUTH_URL}/api/repos`, {
          data: { namespace: ns, name: repo },
        })
      ).ok(),
    ).toBeTruthy()

    const put = await page.request.put(
      `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}/file/main/memo.txt`,
      {
        multipart: {
          file: {
            name: 'memo.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('keep me\n'),
          },
          message: 'seed memo',
        },
      },
    )
    expect(put.ok()).toBeTruthy()
    const putBody = await put.json()
    const seedCommit =
      putBody?.commit?.id || putBody?.status?.commit?.id || null

    expect(
      (
        await page.request.delete(
          `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}/file/main/memo.txt`,
          { multipart: { message: 'delete memo' } },
        )
      ).ok(),
    ).toBeTruthy()

    // Prefer commit id from upload; fall back to branch tip history.
    let restoreFrom = typeof seedCommit === 'string' ? seedCommit : ''
    if (!restoreFrom) {
      const hist = await page.request.get(
        `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}/commits/history/main/memo.txt`,
      )
      expect(hist.ok()).toBeTruthy()
      const histBody = await hist.json()
      restoreFrom = histBody?.commits?.[0]?.id
    }
    expect(restoreFrom).toBeTruthy()

    const restore = await page.request.put(
      `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}/file/main/memo.txt`,
      {
        multipart: {
          file: {
            name: 'memo.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from('keep me\n'),
          },
          message: 'restore memo',
          restore_from: restoreFrom,
        },
      },
    )
    expect(restore.ok()).toBeTruthy()

    const { status, body } = await fetchLineage(page, {
      namespace: ns,
      repo,
      path: 'memo.txt',
      direction: 'both',
      limit: '50',
    })
    expect(status).toBe(200)
    const op = body.operations.find(
      (o: { kind: string; source: string }) =>
        o.kind === 'restore' && o.source === 'explicit',
    )
    expect(op).toBeTruthy()
    expect(op.outputs[0]?.path).toBe('memo.txt')
    expect(op.actor?.sub).toBe(sub)
    expect(op.confidence).toBe('high')
  })

  test('TC-TRACE-07: lineage without session → 401', async ({ page }) => {
    const res = await page.request.get(
      `${AUTH_URL}/auth/lineage?namespace=x&repo=y`,
    )
    expect(res.status()).toBe(401)
  })

  test('TC-TRACE-08: UI lineage panel lists upload after mutate', async ({
    page,
  }) => {
    await sessionLogin(page, {
      name: 'Trace UI',
      email: 'trace-ui@author.test',
      sub: uniqueId('trace-ui'),
    })

    const ns = uniqueId('trace-ui-ns')
    const repo = 'repo'
    expect(
      (
        await page.request.post(`${AUTH_URL}/api/repos`, {
          data: { namespace: ns, name: repo },
        })
      ).ok(),
    ).toBeTruthy()

    expect(
      (
        await page.request.put(
          `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}/file/main/ui.txt`,
          {
            multipart: {
              file: {
                name: 'ui.txt',
                mimeType: 'text/plain',
                buffer: Buffer.from('ui lineage\n'),
              },
              message: 'ui seed',
            },
          },
        )
      ).ok(),
    ).toBeTruthy()

    await page.goto(
      `${BASE_URL}/n/${encodeURIComponent(ns)}/r/${encodeURIComponent(repo)}/blob/main/ui.txt`,
    )
    await page.getByTestId('blob-tab-lineage').click()
    const panel = page.getByTestId('lineage-panel')
    await expect(panel).toBeVisible()
    const graph = page.getByTestId('lineage-graph')
    await expect(graph).toBeVisible({ timeout: 15_000 })
    await expect(graph.locator('text=upload').first()).toBeVisible()
  })

  test('TC-TRACE-09: rebuild derives ops for oxen-only history', async ({
    page,
  }) => {
    await sessionLogin(page, {
      name: 'Trace Rebuild',
      email: 'trace-rebuild@author.test',
      sub: uniqueId('trace-rebuild'),
    })

    const ns = uniqueId('trace-rb-ns')
    const repo = 'repo'
    expect(
      (
        await page.request.post(`${AUTH_URL}/api/repos`, {
          data: { namespace: ns, name: repo },
        })
      ).ok(),
    ).toBeTruthy()

    // Write directly to oxen (bypass BFF) so no explicit lineage exists.
    await putFile(ns, repo, 'main', 'derived.txt', 'v1\n', 'oxen seed v1')
    await putFile(ns, repo, 'main', 'derived.txt', 'v2\n', 'oxen seed v2')

    const before = await fetchLineage(page, {
      namespace: ns,
      repo,
      path: 'derived.txt',
      direction: 'both',
      limit: '50',
    })
    expect(before.status).toBe(200)
    expect(before.body.operations ?? []).toHaveLength(0)

    const rebuild = await page.request.post(`${AUTH_URL}/auth/lineage/rebuild`, {
      data: { namespace: ns, repo, branch: 'main', path: 'derived.txt' },
    })
    expect(rebuild.ok()).toBeTruthy()
    const rebuilt = await rebuild.json()
    expect(rebuilt.created).toBeGreaterThanOrEqual(1)

    const after = await fetchLineage(page, {
      namespace: ns,
      repo,
      path: 'derived.txt',
      direction: 'both',
      limit: '50',
    })
    expect(after.status).toBe(200)
    expect(after.body.operations.length).toBeGreaterThanOrEqual(1)
    expect(
      after.body.operations.some(
        (o: { source: string }) => o.source === 'derived',
      ),
    ).toBeTruthy()

    const again = await page.request.post(`${AUTH_URL}/auth/lineage/rebuild`, {
      data: { namespace: ns, repo, branch: 'main', path: 'derived.txt' },
    })
    expect(again.ok()).toBeTruthy()
    const againBody = await again.json()
    expect(againBody.created).toBe(0)
    expect(againBody.idempotent).toBe(true)
  })

  test('TC-TRACE-10: UI rebuild from history button derives ops', async ({
    page,
  }) => {
    await sessionLogin(page, {
      name: 'Trace Rebuild UI',
      email: 'trace-rb-ui@author.test',
      sub: uniqueId('trace-rb-ui'),
    })

    const ns = uniqueId('trace-rb-ui-ns')
    const repo = 'repo'
    expect(
      (
        await page.request.post(`${AUTH_URL}/api/repos`, {
          data: { namespace: ns, name: repo },
        })
      ).ok(),
    ).toBeTruthy()

    await putFile(ns, repo, 'main', 'ui-derived.txt', 'one\n', 'oxen ui v1')
    await putFile(ns, repo, 'main', 'ui-derived.txt', 'two\n', 'oxen ui v2')

    await page.goto(
      `${BASE_URL}/n/${encodeURIComponent(ns)}/r/${encodeURIComponent(repo)}/blob/main/ui-derived.txt`,
    )
    await page.getByTestId('blob-tab-lineage').click()
    await expect(page.getByTestId('lineage-panel')).toBeVisible()
    await page.getByRole('button', { name: 'Rebuild from history' }).click()
    await expect(page.locator('main .flash-success')).toContainText(/lineage/i, {
      timeout: 30_000,
    })
    await expect(page.getByTestId('lineage-graph')).toBeVisible({
      timeout: 15_000,
    })
    await expect(
      page.getByTestId('lineage-graph').locator('text=upload').first(),
    ).toBeVisible()
  })

  test('TC-TRACE-11: rebuild without session → 401', async ({ page }) => {
    const res = await page.request.post(`${AUTH_URL}/auth/lineage/rebuild`, {
      data: { namespace: 'x', repo: 'y', path: 'z.txt' },
    })
    expect(res.status()).toBe(401)
  })
})
