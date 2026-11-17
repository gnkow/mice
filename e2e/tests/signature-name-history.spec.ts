import { expect } from '@playwright/test'
import { cleanTest as test } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

/**
 * Ticket 47 — Principal name history in UserInfo + access-review signature name display.
 */

test.describe('Signature name history (#47)', () => {
  test('TC-47-01: UserInfo lists chronological name history', async ({ page }) => {
    const iss = 'mice-e2e'
    const sub = uniqueId('name-hist')
    await mintSession(page, { role: 'admin', sub, iss, name: 'Dr. Jane Jones' })

    await page.route('**/auth/admin/principals/names?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          currentName: 'Dr. Jane Jones',
          history: [
            {
              name: 'Dr. Jane Smith',
              validFrom: '2021-03-15T12:00:00.000Z',
              validTo: '2023-01-01T00:00:00.000Z',
            },
            {
              name: 'Dr. Jane Jones',
              validFrom: '2023-01-01T00:00:00.000Z',
              validTo: null,
            },
          ],
        },
      })
    })
    await page.route('**/auth/admin/access-review/overdue', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', json: { overdue: [] } })
    })
    await page.route('**/auth/admin/access-review/**', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          report: {
            reportId: 'r-hist',
            quarter: '2099-Q2',
            generatedAt: Date.now(),
            principals: [
              { principal: { iss, sub, name: 'Dr. Jane Jones' }, roles: [], grants: [] },
            ],
          },
          contentHash: 'h',
        },
      })
    })

    await page.goto('/settings')
    const accessReview = page.locator('#access-review')
    await accessReview.scrollIntoViewIfNeeded()
    await accessReview.getByRole('button', { name: 'Open stored report' }).click()
    await accessReview.getByTestId('user-ref').getByRole('button').click()

    const history = page.getByTestId('user-info-name-history')
    await expect(history).toBeVisible()
    const rows = history.locator('li')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('Dr. Jane Smith')
    await expect(rows.nth(0)).toContainText('2021-03-15')
    await expect(rows.nth(0)).toContainText('2023-01-01')
    await expect(rows.nth(1)).toHaveAttribute('data-current', 'true')
    await expect(rows.nth(1)).toContainText('Dr. Jane Jones')
    await expect(rows.nth(1)).toContainText('current')
  })

  test('TC-47-02: access-review signature shows signed name and now-known-as', async ({
    page,
  }) => {
    const iss = 'mice-e2e'
    const sub = uniqueId('ar-signer')
    await mintSession(page, { role: 'admin', sub, iss, name: 'Dr. Jane Jones' })

    const signedAt = Date.UTC(2021, 2, 15)
    await page.route('**/auth/admin/access-review/overdue', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', json: { overdue: [] } })
    })
    await page.route(`**/auth/admin/access-review/**`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          report: {
            reportId: 'r1',
            quarter: '2026-Q1',
            generatedAt: Date.now(),
            principals: [],
            reviewerSignature: {
              hash: 'abc',
              principal: { iss, sub, name: 'Dr. Jane Smith' },
              signedAt,
              meaning: 'Approved',
              content: '{}',
            },
          },
          contentHash: 'hash',
        },
      })
    })
    await page.route('**/auth/admin/principals/names?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          currentName: 'Dr. Jane Jones',
          history: [
            {
              name: 'Dr. Jane Smith',
              validFrom: '2021-03-15T12:00:00.000Z',
              validTo: '2023-01-01T00:00:00.000Z',
            },
            {
              name: 'Dr. Jane Jones',
              validFrom: '2023-01-01T00:00:00.000Z',
              validTo: null,
            },
          ],
        },
      })
    })

    await page.goto('/settings')
    const accessReview = page.locator('#access-review')
    await accessReview.scrollIntoViewIfNeeded()
    await accessReview.getByRole('button', { name: 'Open stored report' }).click()

    const sig = page.getByTestId('access-review-signature')
    await expect(sig).toContainText('Signed by:')
    await expect(sig.getByTestId('user-ref')).toContainText('Dr. Jane Smith')
    await expect(sig).toContainText('2021-03-15')
    await expect(sig.getByTestId('signature-now-known-as')).toContainText(
      'Now known as: Dr. Jane Jones',
    )
    await sig.getByTestId('user-ref').getByRole('button').click()
    const history = page.getByTestId('user-info-name-history')
    await expect(history).toBeVisible()
    await expect(history.locator('li[data-current="true"]')).toContainText('Dr. Jane Jones')
  })
})
