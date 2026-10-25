import { test as base, expect, type Page } from '@playwright/test'
import {
  createRepo,
  deleteRepo,
  putFile,
  uniqueId,
  waitForOxen,
} from './helpers/oxenApi'
import { cleanupContext, cleanupSince, revokeTokensSince, snapshot, trackSessionCookies } from './helpers/cleanup'
import { mintSession } from './helpers/session'

export type RepoFixture = {
  namespace: string
  repo: string
  seeded: boolean
}

type Fixtures = {
  emptyRepo: RepoFixture
  seededRepo: RepoFixture
}

async function makeRepo(seeded: boolean): Promise<RepoFixture> {
  const namespace = uniqueId('mice-e2e')
  const repo = 'repo'
  await createRepo(namespace, repo)
  if (seeded) {
    await putFile(
      namespace,
      repo,
      'main',
      'readme.txt',
      'hello from e2e\n',
      'seed readme',
    )
  }
  return { namespace, repo, seeded }
}

/**
 * Every test removes the namespaces, instance admins and default-user tokens it
 * added, even when it fails. Suite runs serially, so a before/after diff is safe.
 */
export const cleanTest = base.extend<{ bffCleanup: void }>({
  bffCleanup: [
    async ({ context }, use) => {
      const sessionCookies = trackSessionCookies(context)
      const startedAt = Date.now() - 1000
      const ctx = await cleanupContext()
      const before = await snapshot(ctx)
      await use()
      await revokeTokensSince(sessionCookies(), startedAt).catch(() => undefined)
      await cleanupSince(ctx, before)
      await ctx.dispose()
    },
    { auto: true },
  ],
})

/** Establish a BFF session before UI tests hit /api. */
export const test = cleanTest.extend<Fixtures>({
  page: async ({ page }, use) => {
    await mintSession(page)
    await use(page)
  },
  emptyRepo: async ({}, use) => {
    await waitForOxen()
    const ctx = await makeRepo(false)
    await use(ctx)
    await deleteRepo(ctx.namespace, ctx.repo)
  },
  seededRepo: async ({}, use) => {
    await waitForOxen()
    const ctx = await makeRepo(true)
    await use(ctx)
    await deleteRepo(ctx.namespace, ctx.repo)
  },
})

export { expect }

export function repoPath(ctx: RepoFixture, suffix = '') {
  const base = `/n/${encodeURIComponent(ctx.namespace)}/r/${encodeURIComponent(ctx.repo)}`
  return suffix ? `${base}${suffix}` : base
}

/** Complete the in-app confirm modal (optionally with typed word). */
export async function acceptConfirmModal(page: Page, confirmWord?: string) {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  if (confirmWord !== undefined) {
    await dialog.locator('input').fill(confirmWord)
  }
  await dialog.getByRole('button', { name: 'Confirm' }).click()
  await expect(dialog).toHaveCount(0, { timeout: 10_000 })
}

export async function openAccountMenu(page: Page) {
  await page.locator('details.profile-menu > summary').click()
}

export async function openSettings(page: Page) {
  await openAccountMenu(page)
  await page
    .locator('.profile-menu-panel')
    .getByRole('link', { name: 'Settings' })
    .click()
}

/** Repo title in the title bar (avoids breadcrumb h1 strict-mode clashes). */
export function repoTitle(page: Page, name: string) {
  return page.locator('h2.repo-title-name', { hasText: name })
}

/** File name link in the tree list (avoids latest-commit message link clashes). */
export function fileNameLink(page: Page, name: string | RegExp) {
  return page.locator('a.file-name-link', { hasText: name })
}

/** Open a file-row ⋯ menu action (Delete / Move / …). */
export async function fileRowAction(
  page: Page,
  entryName: string | RegExp,
  action: string | RegExp,
) {
  const row = page.locator('.file-row', {
    has: page.locator('a.file-name-link', { hasText: entryName }),
  })
  await row.hover()
  await row.locator('summary[aria-label^="More actions"]').click({ force: true })
  await row.locator('.row-more-menu').getByRole('button', { name: action }).click()
}
