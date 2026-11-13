import { test, expect } from '../fixtures'
import { mintSession } from '../helpers/session'

test.describe('Instance admin separation of duties', () => {
  test('TC-SOD-01: admin sees no namespaces they are not a member of, and no Delete controls', async ({
    page,
    seededRepo,
  }) => {
    await mintSession(page, { sub: `sod-admin-${Date.now()}`, role: 'admin' })
    await page.goto('/namespaces')
    await expect(page.getByRole('heading', { name: 'Namespaces', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: seededRepo.namespace, exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Delete/ })).toHaveCount(0)
    await expect(page.getByText(/separation of duties/i)).toBeVisible()

    await page.getByRole('button', { name: 'Open navigation' }).click()
    await expect(page.getByRole('link', { name: 'Audit' })).toHaveCount(0)

    const api = await page.request.get('/auth/namespaces')
    const body = (await api.json()) as { namespaces: { name: string }[] }
    expect(body.namespaces.map((n) => n.name)).not.toContain(seededRepo.namespace)
  })

  test('TC-SOD-02: the owning manager still sees the namespace and its Delete control', async ({
    page,
    seededRepo,
  }) => {
    await mintSession(page)
    await page.goto('/namespaces')
    await expect(page.getByRole('link', { name: seededRepo.namespace, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Delete/ }).first()).toBeVisible()
  })

  test('TC-SOD-03: Settings administrators copy states no data or audit access', async ({ page }) => {
    await mintSession(page, { sub: `sod-admin-settings-${Date.now()}`, role: 'admin' })
    await page.goto('/settings#instance-administrators')
    await expect(page.getByRole('heading', { name: /Instance administrators/i })).toBeVisible()
    await expect(page.getByText(/no namespace membership, repository data, or audit trail/i)).toBeVisible()
  })
})
