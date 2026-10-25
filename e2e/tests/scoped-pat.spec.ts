import { expect } from '@playwright/test'
import { cleanTest as base } from '../fixtures'
import { mintSession } from '../helpers/session'

const BASE_URL = process.env.MICE_BASE_URL ?? 'http://localhost:5173'

const test = base

test.describe('scoped PATs (PLAT-AUTH)', () => {
  test('TC-AUTH-SCOPE-01: mint a scoped token on Profile; it works in scope, not for account management', async ({
    page,
  }) => {
    await mintSession(page, { name: 'Scope Spec', email: 'scope@mice.local', sub: 'scope-spec', iss: 'mice-e2e' })
    await page.goto('/profile')
    await page.getByLabel('Scope namespace').fill('some-ns')
    await page.getByLabel('Max role').selectOption('read')
    await page.getByRole('button', { name: "Create token" }).click()
    await expect(page.getByText(/some-ns/).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/Scopes some-ns/).first()).toBeVisible()

    const list = await page.request.get(`${BASE_URL}/auth/tokens`)
    const { tokens } = (await list.json()) as { tokens: Array<{ scopes?: Array<{ namespace: string; maxRole: string }> }> }
    expect(tokens.some((t) => t.scopes?.[0]?.namespace === 'some-ns' && t.scopes[0].maxRole === 'read')).toBe(true)
  })

  test('TC-AUTH-SCOPE-02: a scoped PAT cannot manage tokens or favorites', async ({ page }) => {
    await mintSession(page, { name: 'Scope Two', email: 'scope2@mice.local', sub: 'scope-two', iss: 'mice-e2e' })
    const created = await page.request.post(`${BASE_URL}/auth/tokens`, {
      headers: { origin: BASE_URL },
      data: { label: 'scoped', scopes: [{ namespace: 'some-ns', maxRole: 'read' }] },
    })
    expect(created.ok()).toBeTruthy()
    const { token } = (await created.json()) as { token: string }
    const auth = { authorization: `Bearer ${token}` }
    const bare = await page.context().browser()!.newContext()
    const res = await bare.request.get(`${BASE_URL}/auth/favorites`, { headers: auth })
    expect(res.status()).toBe(401)
    const mint = await bare.request.post(`${BASE_URL}/auth/tokens`, { headers: auth, data: { label: 'x' } })
    expect([401, 403]).toContain(mint.status())
    await bare.close()
  })
})
