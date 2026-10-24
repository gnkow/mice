import { test, expect, repoPath } from '../fixtures'
import type { Page } from '@playwright/test'

test('main navigation and home tiles have leading entity icons', async ({ page, seededRepo }) => {
  await page.goto('/')
  const tiles = page.locator('.dash-tile-main')
  await expect(tiles).toHaveCount(5)
  for (const tile of await tiles.all()) {
    await expect(tile.locator('.dash-tile-label svg')).toHaveCount(1)
  }
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click()
  const navigation = page.getByRole('complementary', { name: 'Main navigation', exact: true })
  const links = navigation.locator('.drawer-nav a')
  await expect(links).toHaveCount(9)
  for (const link of await links.all()) {
    await expect(link.locator('svg')).toHaveCount(1)
  }
  await navigation.getByRole('link', { name: 'Repositories', exact: true }).click()
  await expect(navigation).toHaveCount(0)
  await expect(page).toHaveURL(/\/repositories$/)
  await page.goto(`/repositories?q=${encodeURIComponent(seededRepo.namespace)}`)
  await expect(page.locator(`a[href="${repoPath(seededRepo, '/tree/main')}"]`).first()).toBeVisible()
})

async function expectLeadingIcons(page: Page) {
  const controls = page.locator('button, a.btn, summary.btn, [role="menuitem"], [role="button"]')
  const issues = await controls.evaluateAll(elements => elements.flatMap(el => {
    if (!(el instanceof HTMLElement) || !el.checkVisibility()) return []
    const text = el.innerText.trim()
    if (!text || text === '×' || el.querySelector('.avatar-circle')) return []
    if (!el.querySelector('svg')) return [`Missing icon for "${text}"`]
    const leading = (() => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        if (node instanceof SVGElement) return true
        if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return false
      }
      return false
    })()
    return leading ? [] : [`Icon should precede "${text}"`]
  }))
  expect(issues).toEqual([])
}

test('text actions use leading icons across lists, detail pages, menus and dialogs', async ({ page, seededRepo }) => {
  for (const path of ['/branches', '/branches/main', '/stages', '/jobs', '/sessions', '/settings', '/tree/main', '/commits']) {
    await page.goto(repoPath(seededRepo, path))
    await expect(page.getByRole('heading', { level: 1 }).last()).toBeVisible()
    await expectLeadingIcons(page)
    await expect(page.getByRole('link', { name: /^All (jobs|workspaces|sessions)$/ })).toHaveCount(0)
  }
  for (const path of ['/namespaces', '/repositories', '/workspaces', '/jobs', '/sessions', '/settings', '/meta', '/repos/new', '/namespaces/new']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1 }).last()).toBeVisible()
    await expectLeadingIcons(page)
  }
  await page.goto(repoPath(seededRepo, '/tree/main'))
  await page.locator('summary', { hasText: 'Manage Files' }).click()
  await expect(page.getByRole('button', { name: 'Upload', exact: true })).toBeVisible()
  await expectLeadingIcons(page)
  await page.goto(repoPath(seededRepo, '/branches'))
  await page.getByRole('button', { name: 'New branch', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Create a branch' })).toBeVisible()
  await expectLeadingIcons(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.locator('.clone-dropdown > summary').click()
  await expect(page.getByRole('menu', { name: 'Clone repository' })).toBeVisible()
  await expectLeadingIcons(page)
})
