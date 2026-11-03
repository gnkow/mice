import { expect } from '@playwright/test'
import { cleanTest as test } from '../fixtures'
import { mintSession } from '../helpers/session'

test('admin publishes, hides and deletes an announcement', async ({ page }) => {
  await mintSession(page, { role: 'admin' })
  const title = `Maintenance ${Date.now()}`
  await page.goto('/settings')
  await expect(page.getByRole('link', { name: 'Announcements' })).toBeVisible()
  const section = page.locator('#announcements')
  await section.getByLabel('Title').fill(title)
  await section.getByLabel('Severity').selectOption('warning')
  await section.getByLabel('Message').fill('Brief downtime tonight')
  await section.getByRole('button', { name: 'Publish announcement' }).click()
  const row = section.locator('li', { hasText: title })
  await expect(row).toContainText('Live')

  await page.goto('/')
  const banner = page.getByRole('region', { name: 'Announcements' })
  await expect(banner).toContainText(title)
  await banner.getByRole('button', { name: `Dismiss announcement: ${title}` }).click()
  await expect(page.getByRole('region', { name: 'Announcements' })).toHaveCount(0)

  await page.goto('/settings')
  await section.locator('li', { hasText: title }).getByRole('button', { name: 'Hide' }).click()
  await expect(section.locator('li', { hasText: title })).toContainText('Hidden')
  page.once('dialog', (d) => void d.accept())
  await section.locator('li', { hasText: title }).getByRole('button', { name: 'Delete' }).click()
  await expect(section.locator('li', { hasText: title })).toHaveCount(0)
})
