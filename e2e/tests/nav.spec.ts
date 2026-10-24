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
      await expect(page.locator('main .flash-error')).toHaveCount(0)
    }

    await expect(page.locator('nav.repo-nav details.repo-nav-more')).toHaveCount(
      0,
    )
  })

  test('TC-NAV-02: Merge lives under Branches (Branches / Compare / Merge views)', async ({
    page,
    seededRepo,
  }) => {
    await page.goto(repoPath(seededRepo))
    const repoNav = page.locator('nav.repo-nav')
    await expect(repoNav.getByRole('link', { name: 'Merge', exact: true })).toHaveCount(0)

    await repoNav.getByRole('link', { name: 'Branches', exact: true }).click()
    const views = page.getByRole('navigation', { name: 'Branch views' })
    await expect(views.getByRole('link', { name: 'Branches', exact: true })).toHaveClass(/active/)

    await views.getByRole('link', { name: 'Compare', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Compare', exact: true })).toBeVisible()
    await expect(repoNav.getByRole('link', { name: 'Branches', exact: true })).toHaveClass(/active/)

    await views.getByRole('link', { name: 'Merge', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Merge', exact: true })).toBeVisible()
    await expect(views.getByRole('link', { name: 'Merge', exact: true })).toHaveClass(/active/)

    await views.getByRole('link', { name: 'Stages', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Stages', exact: true })).toBeVisible()
    await expect(views.getByRole('link', { name: 'Stages', exact: true })).toHaveClass(/active/)
    await expect(repoNav.getByRole('link', { name: 'Workspaces', exact: true })).not.toHaveClass(/active/)
    await expect(repoNav.getByRole('link', { name: 'Branches', exact: true })).toHaveClass(/active/)
  })
})
