import { expect, repoPath, test } from '../fixtures'

/**
 * Ticket #68 — Stable repository IDs surface in the UI after AuthZ mint.
 */
test.describe('Stable repository id (#68)', () => {
  test('repo overview shows a copyable AuthZ repository id', async ({ page, seededRepo }) => {
    await page.goto(repoPath(seededRepo))
    const idControl = page.getByTestId('entity-id-repository').first()
    await expect(idControl).toBeVisible({ timeout: 20_000 })
    const fullId = await idControl.getAttribute('data-entity-id')
    expect(fullId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    await expect(idControl).toHaveAttribute(
      'aria-label',
      new RegExp(`Repository ID ${fullId}`, 'i'),
    )
  })
})
