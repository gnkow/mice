import { expect } from '@playwright/test'
import { cleanTest as test } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'
type Page = import('@playwright/test').Page
type Ref = { type: string; id: string; scope?: { kind: 'branch' | 'commit'; id: string } }

async function setup(page: Page) {
  await mintSession(page, { name: 'Meta Tester', email: 'meta@x.test', sub: uniqueId('meta'), iss: 'mice-e2e' })
  const ns = uniqueId('meta-ns')
  expect((await page.request.post(`${AUTH_URL}/api/repos`, { data: { namespace: ns, name: 'data' } })).ok()).toBeTruthy()
  return ns
}
const patch = (page: Page, ref: Ref, body: Record<string, unknown>) => page.request.patch(`${AUTH_URL}/auth/meta`, { data: { ref, ...body } })
const params = (ref: Ref) => new URLSearchParams({ type: ref.type, id: ref.id, ...(ref.scope ? { scope: ref.scope.kind, revision: ref.scope.id } : {}) })
const get = async (page: Page, ref: Ref) => (await page.request.get(`${AUTH_URL}/auth/meta?${params(ref)}`)).json()

test.describe('explicit metadata (PLAT-META)', () => {
  test('entity and path scopes are independent in API, batch, and search', async ({ page }) => {
    const ns = await setup(page)
    const refs: Ref[] = [
      { type: 'namespace', id: ns }, { type: 'repo', id: `${ns}/data` },
      { type: 'branch', id: `${ns}/data@main` }, { type: 'commit', id: `${ns}/data#abc` },
      { type: 'workspace', id: `${ns}/data!w1` },
    ]
    for (const type of ['file', 'directory']) {
      const id = `${ns}/data:images/${type === 'file' ? 'a.png' : ''}`
      refs.push({ type, id }, { type, id, scope: { kind: 'branch', id: 'main' } }, { type, id, scope: { kind: 'commit', id: 'abc' } })
    }
    for (const [i, ref] of refs.entries()) {
      expect((await get(page, ref)).effective).toEqual({ tags: [], labels: {} })
      expect((await patch(page, ref, { tags: [`item${i}`], labels: { owner: String(i) } })).ok()).toBeTruthy()
    }
    for (const [i, ref] of refs.entries()) {
      const data = await get(page, ref)
      expect(data.effective).toEqual({ tags: [{ value: `item${i}` }], labels: { owner: { value: String(i) } } })
      expect(data.chain).toBeUndefined()
      expect(data.removed).toBeUndefined()
    }
    const unannotated = { type: 'file', id: `${ns}/data:images/other.png`, scope: { kind: 'branch' as const, id: 'main' } }
    expect((await get(page, unannotated)).effective).toEqual({ tags: [], labels: {} })
    const batch = await (await page.request.post(`${AUTH_URL}/auth/meta/batch`, { data: { refs: [...refs, unannotated] } })).json()
    expect(Object.keys(batch.items)).toHaveLength(refs.length + 1)
    const search = await (await page.request.get(`${AUTH_URL}/auth/meta/search?namespace=${ns}&tag=item0`)).json()
    expect(search.coverage.complete).toBe(true)
    expect(search.hits.map((h: { ref: Ref }) => h.ref)).toEqual([expect.objectContaining(refs[0])])
    const branchFile = refs.find(r => r.type === 'file' && r.scope?.kind === 'branch')!
    expect((await page.request.delete(`${AUTH_URL}/auth/meta?${params(branchFile)}`)).ok()).toBeTruthy()
    expect((await get(page, branchFile)).effective).toEqual({ tags: [], labels: {} })
    expect((await get(page, { type: 'file', id: branchFile.id })).own).not.toBeNull()
  })

  test('editor adds, edits, renames and removes tags and labels without inheritance controls', async ({ page }) => {
    const ns = await setup(page)
    const ref = { type: 'repo', id: `${ns}/data` }
    await patch(page, { type: 'namespace', id: ns }, { tags: ['parent'], labels: { owner: 'parent' } })
    await page.goto(`/meta?${params(ref)}`)
    await expect(page.getByTestId('meta-tags')).not.toContainText('parent')
    await expect(page.getByRole('button', { name: /Inherited|Override|Trace|Inheritance settings|Reset/ })).toHaveCount(0)
    await page.getByLabel('Add tag', { exact: true }).fill('draft')
    await page.getByRole('button', { name: 'Add tag', exact: true }).click()
    await expect(page.getByTestId('meta-tags')).toContainText('draft')
    await page.getByRole('button', { name: 'Edit tag draft' }).click()
    await page.getByLabel('Name for tag draft').fill('reviewed')
    await page.getByRole('button', { name: 'Save tag' }).click()
    await expect(page.getByTestId('meta-tags')).toContainText('reviewed')
    await expect(page.getByTestId('meta-tags')).not.toContainText('draft')
    await page.getByLabel('Key', { exact: true }).fill('owner')
    await page.getByLabel('Value', { exact: true }).fill('team')
    await page.getByRole('button', { name: 'Add label', exact: true }).click()
    await expect(page.getByTestId('meta-labels')).toContainText('team')
    await page.getByTestId('meta-labels').getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByLabel('Key for owner').fill('maintainer')
    await page.getByLabel('Value for owner').fill('')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByTestId('meta-labels')).toContainText('Empty value')
    expect((await get(page, ref)).own.labels).toEqual({ maintainer: '' })
    await page.getByRole('button', { name: 'Remove tag reviewed' }).click()
    await expect(page.getByTestId('meta-tags')).not.toContainText('reviewed')
    await page.getByRole('button', { name: 'Remove label maintainer' }).click()
    await expect(page.getByTestId('meta-labels')).toHaveCount(0)
    expect((await get(page, ref)).own).toBeNull()
    expect((await get(page, ref)).effective).toEqual({ tags: [], labels: {} })
  })

  test('file and folder editor can switch between all three independent scopes', async ({ page }) => {
    const ns = await setup(page)
    for (const type of ['file', 'directory']) {
      const ref = { type, id: `${ns}/data:images/${type === 'file' ? 'a.png' : ''}` }
      await patch(page, ref, { tags: ['general'] })
      await patch(page, { ...ref, scope: { kind: 'branch', id: 'main' } }, { tags: ['branch'] })
      await patch(page, { ...ref, scope: { kind: 'commit', id: 'abc' } }, { tags: ['commit'] })
      await page.goto(`/meta?${params(ref)}`)
      await expect(page.getByLabel('Metadata scope')).toHaveValue('repository')
      await expect(page.getByTestId('meta-tags')).toContainText('general')
      await page.getByLabel('Metadata scope').selectOption('branch')
      await page.getByLabel('Scope revision').fill('main')
      await expect(page.getByTestId('meta-tags')).toContainText('branch')
      await expect(page.getByTestId('meta-tags')).not.toContainText('general')
      await page.getByLabel('Metadata scope').selectOption('commit')
      await page.getByLabel('Scope revision').fill('abc')
      await expect(page.getByTestId('meta-tags')).toContainText('commit')
      await page.getByLabel('Scope revision').fill('other')
      await expect(page.getByTestId('meta-tags')).not.toContainText('commit')
      await expect(page.getByTestId('meta-tags')).not.toContainText('general')
      await page.getByLabel('Metadata scope').selectOption('repository')
      await expect(page.getByTestId('meta-tags')).toContainText('general')
    }
  })

  test('tag merges and clearing metadata remain explicit-only', async ({ page }) => {
    const ns = await setup(page)
    const ref = { type: 'repo', id: `${ns}/data` }
    await patch(page, { type: 'namespace', id: ns }, { tags: ['parent'] })
    await patch(page, ref, { tags: ['first', 'second'], labels: { owner: 'local' } })
    await page.goto(`/meta?${params(ref)}`)
    await page.getByRole('button', { name: 'Edit tag first' }).click()
    await page.getByLabel('Name for tag first').fill('second')
    await page.getByRole('button', { name: 'Save tag', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: /Confirm/ }).click()
    await expect(page.getByRole('button', { name: 'Edit tag first' })).toHaveCount(0)
    expect((await get(page, ref)).own.tags).toEqual(['second'])
    await page.getByRole('button', { name: 'Clear all metadata', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: /Confirm/ }).click()
    await expect(page.getByTestId('meta-tags')).not.toContainText('second')
    await expect(page.getByTestId('meta-tags')).not.toContainText('parent')
    await expect(page.getByTestId('meta-labels')).toHaveCount(0)
    expect((await get(page, ref)).own).toBeNull()
  })

  test('stale drafts survive concurrent deletion and rename collisions require confirmation', async ({ page }) => {
    const ns = await setup(page)
    const ref = { type: 'repo', id: `${ns}/data` }
    await patch(page, ref, { labels: { owner: 'original', destination: 'existing' } })
    await page.goto(`/meta?${params(ref)}`)
    await page.getByTestId('meta-labels').locator('tr').filter({ hasText: 'original' }).getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByLabel('Value for owner').fill('draft')
    await patch(page, ref, { labels: { owner: null } })
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Metadata changed since you loaded it.', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Load latest metadata' }).click()
    await expect(page.getByLabel('Value for owner')).toHaveValue('draft')
    await page.getByLabel('Key for owner').fill('destination')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByLabel('Value for owner')).toHaveValue('draft')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: /Confirm/ }).click()
    await expect(page.getByTestId('meta-labels')).toContainText('draft')
    expect((await get(page, ref)).own.labels).toEqual({ destination: 'draft' })
  })

  test('parent edits do not invalidate a save; obsolete inheritance options are rejected', async ({ page, playwright }) => {
    const ns = await setup(page)
    const ref = { type: 'repo', id: `${ns}/data` }
    const current = await get(page, ref)
    await patch(page, { type: 'namespace', id: ns }, { tags: ['parent'] })
    expect((await patch(page, ref, { tags: ['local'], ifRevision: current.revision, ifVersion: current.version })).ok()).toBeTruthy()
    for (const body of [{ inherit: false }, { propagation: {} }, { removeTags: ['old'] }, { unset: { labels: ['old'] } }]) {
      expect((await patch(page, ref, body)).status()).toBe(422)
    }
    expect((await patch(page, ref, { tags: ['Bad Tag!'] })).status()).toBe(422)
    expect((await patch(page, { type: 'namespace', id: 'missing-xyz' }, { tags: ['a'] })).status()).toBe(404)
    expect((await page.request.get(`${AUTH_URL}/auth/meta/search?source=inherited`)).status()).toBe(400)
    expect((await page.request.get(`${AUTH_URL}/auth/meta?${params(ref)}&trace=tag:local`)).status()).toBe(400)
    const anon = await playwright.request.newContext()
    expect((await anon.get(`${AUTH_URL}/auth/meta?${params(ref)}`)).status()).toBe(401)
    await anon.dispose()
  })

  test('entity settings and metadata search show only directly assigned entries', async ({ page }) => {
    const ns = await setup(page)
    const tag = uniqueId('tag').toLowerCase()
    await page.goto(`/n/${ns}/settings`)
    const panel = page.locator('section[aria-labelledby="ns-meta-heading"]')
    await panel.getByLabel('Add tag').fill(tag)
    await panel.getByRole('button', { name: 'Add tag', exact: true }).click()
    await expect(panel.getByTestId('meta-tags')).toContainText(tag)
    await page.goto(`/n/${ns}/r/data/settings`)
    const repo = page.locator('section[aria-labelledby="repo-meta-heading"]')
    await expect(repo.getByTestId('meta-tags')).not.toContainText(tag)
    await page.goto('/meta')
    await expect(page.getByRole('heading', { name: /Latest metadata/ })).toBeVisible()
    await expect(page.getByLabel('Provenance')).toHaveCount(0)
    await page.locator('input[name=q]').fill(`tag:${tag}`)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByTestId('meta-results')).toContainText(ns)
    await expect(page.getByTestId('meta-results')).not.toContainText(`${ns}/data`)
  })
})
