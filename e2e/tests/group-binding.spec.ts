import { test, expect, openAccountMenu } from '../fixtures'
import { mintSession } from '../helpers/session'

const ID_BASED = {
  mode: 'id-based' as const,
  message: 'Group binding mode: ID-based (recommended)',
  warning: false,
  checkedAt: '2026-11-13T12:00:00.000Z',
}

const NAME_BASED = {
  mode: 'name-based' as const,
  message:
    'Group IDs not available. Binding uses names. IdP group rename will break access.',
  warning: true,
  checkedAt: '2026-11-13T12:05:00.000Z',
}

async function openGroupBinding(page: import('@playwright/test').Page) {
  await page.goto('/')
  await openAccountMenu(page)
  await page
    .locator('.profile-menu-panel')
    .getByRole('link', { name: 'Settings' })
    .click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await page.getByRole('link', { name: 'Group binding', exact: true }).click()
  return page.locator('#group-binding')
}

test.describe('Group binding validation (#09)', () => {
  test('TC-GB-01: admin opens Group binding via Settings nav and can Check', async ({
    page,
  }) => {
    await mintSession(page, { sub: 'e2e-group-binding-admin', role: 'admin' })

    await page.route('**/auth/instance/group-binding', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            mode: 'id-based',
            message: ID_BASED.message,
            warning: false,
            checkedAt: null,
          }),
        })
        return
      }
      await route.continue()
    })
    await page.route('**/auth/instance/group-binding/check', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ID_BASED),
      })
    })

    const section = await openGroupBinding(page)

    await expect(
      section.getByRole('heading', { name: /Group binding validation/i }),
    ).toBeVisible()
    await expect(
      section.getByText(/immutable group object ids|No binding check yet|binding/i).first(),
    ).toBeVisible()
    await expect(section.getByLabel(/Optional sample group ids/i)).toBeVisible()

    const checkButton = section.getByRole('button', { name: /Check|Checking/i })
    await expect(checkButton).toBeVisible()
    await checkButton.click()
    await expect(section.getByTestId('group-binding-status')).toBeVisible({
      timeout: 15_000,
    })
  })

  test('TC-GB-02: ID-based check surfaces recommended mode badge', async ({ page }) => {
    await mintSession(page, { sub: `e2e-gb-id-${Date.now()}`, role: 'admin' })

    await page.route('**/auth/instance/group-binding', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            mode: 'id-based',
            message: ID_BASED.message,
            warning: false,
            checkedAt: null,
          }),
        })
        return
      }
      await route.continue()
    })
    await page.route('**/auth/instance/group-binding/check', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ID_BASED),
      })
    })

    const section = await openGroupBinding(page)
    await section.getByRole('button', { name: /^Check$/i }).click()

    await expect(section.getByTestId('group-binding-mode').first()).toHaveAttribute(
      'data-mode',
      'id-based',
    )
    await expect(section.getByTestId('group-binding-status')).toContainText(
      /ID-based \(recommended\)/i,
    )
    await expect(section.getByText(/confirmed object-id group grants/i)).toBeVisible()
  })

  test('TC-GB-03: name-based sample forces persistent warning copy', async ({ page }) => {
    await mintSession(page, { sub: `e2e-gb-name-${Date.now()}`, role: 'admin' })

    await page.route('**/auth/instance/group-binding', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            mode: 'name-based',
            message: NAME_BASED.message,
            warning: true,
            checkedAt: null,
          }),
        })
        return
      }
      await route.continue()
    })
    await page.route('**/auth/instance/group-binding/check', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(NAME_BASED),
      })
    })

    const section = await openGroupBinding(page)
    await section
      .getByLabel(/Optional sample group ids/i)
      .fill('engineering-team')
    await section.getByRole('button', { name: /^Check$/i }).click()

    const status = section.getByTestId('group-binding-status')
    await expect(status).toHaveClass(/flash-warn/)
    await expect(section.getByTestId('group-binding-mode').first()).toHaveAttribute(
      'data-mode',
      'name-based',
    )
    await expect(status).toContainText(/IdP group rename will break access/i)
    await expect(status).toContainText(/Namespace owners see this same warning/i)
  })
})
