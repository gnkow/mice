import { test, expect, repoPath, repoTitle } from '../fixtures'
import type { Locator } from '@playwright/test'

test.describe('repo nav (TC-NAV-01)', () => {
  test('TC-NAV-01: RepoNav links load each page', async ({
    page,
    seededRepo,
  }) => {
    await page.goto(repoPath(seededRepo))
    await expect(repoTitle(page, seededRepo.repo)).toBeVisible()
    await expect(page.locator('aside.repo-aside')).toBeVisible()

    const primary: { link: string; ready: () => Locator }[] = [
      {
        link: 'Data',
        ready: () => repoTitle(page, seededRepo.repo),
      },
      {
        link: 'Branches',
        ready: () => page.getByRole('heading', { name: 'Branches', exact: true }),
      },
      {
        link: 'Merge',
        ready: () => page.getByRole('heading', { name: 'Merge', exact: true }),
      },
      {
        link: 'Workspaces',
        ready: () =>
          page.getByRole('heading', { name: 'Workspaces', exact: true }),
      },
      {
        link: 'Settings',
        ready: () => page.getByRole('heading', { name: 'Settings', exact: true }),
      },
    ]

    for (const stop of primary) {
      await page
        .locator('nav.repo-nav')
        .getByRole('link', { name: stop.link, exact: true })
        .click()
      await expect(stop.ready()).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('main p.error')).toHaveCount(0)
    }

    await expect(page.locator('nav.repo-nav details.repo-nav-more')).toHaveCount(
      0,
    )
  })
})
