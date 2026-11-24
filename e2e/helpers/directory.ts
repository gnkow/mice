import { expect, type Locator, type Page, type Route } from '@playwright/test'

export type DirectoryUserHit = {
  kind: 'user'
  sub: string
  iss: string
  name?: string
  email?: string
}

export type DirectoryGroupHit = {
  kind: 'group'
  group: string
  name: string
}

/** Stub `/auth/directory/search` so DirectoryPicker can select without Manual entry. */
export async function mockDirectorySearch(
  page: Page,
  results: Array<DirectoryUserHit | DirectoryGroupHit>,
  source = 'store',
) {
  await page.route('**/auth/directory/search**', async (route: Route) => {
    const url = new URL(route.request().url())
    const kind = url.searchParams.get('kind') ?? 'user'
    const q = (url.searchParams.get('q') ?? '').toLowerCase()
    const filtered = results.filter((r) => {
      if (r.kind !== kind) return false
      if (!q) return true
      if (r.kind === 'user') {
        return (
          r.sub.toLowerCase().includes(q) ||
          (r.name ?? '').toLowerCase().includes(q) ||
          (r.email ?? '').toLowerCase().includes(q) ||
          r.iss.toLowerCase().includes(q)
        )
      }
      return (
        r.group.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q)
      )
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ source, results: filtered }),
    })
  })
}

/** Type into Search directory and click the first matching option. */
export async function pickFromDirectory(
  root: Page | Locator,
  query: string,
  optionText: string | RegExp,
) {
  const search = root.getByLabel('Search directory').first()
  await search.fill(query)
  const option = root
    .locator('.directory-picker-option')
    .filter({ hasText: optionText })
    .first()
  await expect(option).toBeVisible()
  await option.click()
  await expect(root.getByText(/Selected:/i)).toBeVisible()
}
