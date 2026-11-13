import { expect } from '@playwright/test'
import { cleanTest as test } from '../fixtures'
import { mintSession } from '../helpers/session'

/**
 * Ticket 49 — Commit views show stored email and current email when they differ.
 */

const ns = 'email-ns'
const repo = 'email-repo'
const author = 'mice-e2e|commit-author'
const commit = {
  id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  parent_ids: [] as string[],
  message: 'email clarity commit',
  author,
  email: 'stored@mice.local',
  timestamp: new Date().toISOString(),
}

const ok = { status: 'success', status_message: 'resource_found' }

async function mockRepoApis(
  page: import('@playwright/test').Page,
  currentEmail: string,
) {
  await page.route(`**/api/repos/${ns}/${repo}**`, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith(`/repos/${ns}/${repo}`) || path.endsWith(`/repos/${ns}/${repo}/`)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          ...ok,
          repository: {
            namespace: ns,
            name: repo,
            is_empty: false,
            storage_kind: 'local',
            data_types: [{ data_type: 'text', count: 1 }],
          },
        },
      })
    }
    if (path.endsWith('/stats')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          ...ok,
          repository: { data_types: [{ data_type: 'text', data_size: 1, file_count: 1 }] },
        },
      })
    }
    if (path.endsWith('/size')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: { ...ok, size_file: { status: 'done', size: 1 } },
      })
    }
    if (path.endsWith('/workspaces')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: { ...ok, workspaces: [] },
      })
    }
    if (path.endsWith('/branches')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: { ...ok, branches: [{ name: 'main', commit_id: commit.id }] },
      })
    }
    if (path.includes('/commits/history/') || path.endsWith('/commits/all')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: {
          ...ok,
          commits: [commit],
          page_number: 1,
          page_size: 50,
          total_pages: 1,
          total_entries: 1,
        },
      })
    }
    if (path.includes('/commits/root')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: { ...ok, commit },
      })
    }
    if (path.endsWith(`/commits/${commit.id}`)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: { ...ok, commit },
      })
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: { ...ok },
    })
  })
  await page.route('**/auth/principals/emails', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: { emails: { [author]: currentEmail } },
    })
  })
}

test.describe('Commit email display (#49)', () => {
  test('TC-49-01: commit list shows stored email and current when they differ', async ({
    page,
  }) => {
    await mintSession(page, { role: 'manager' })
    await mockRepoApis(page, 'current@mice.local')

    await page.goto(`/n/${ns}/r/${repo}/commits`)
    const email = page.getByTestId('commit-email').first()
    await expect(email.locator('.mono')).toContainText('stored@mice.local')
    await expect(email.getByTestId('commit-email-current')).toContainText(
      'current: current@mice.local',
    )
    await expect(email).toHaveAttribute(
      'aria-label',
      'Commit email stored@mice.local, current email current@mice.local',
    )
  })

  test('TC-49-02: matching current email does not show a current note', async ({
    page,
  }) => {
    await mintSession(page, { role: 'manager' })
    await mockRepoApis(page, 'stored@mice.local')

    await page.goto(`/n/${ns}/r/${repo}/commits`)
    const email = page.getByTestId('commit-email').first()
    await expect(email.locator('.mono')).toContainText('stored@mice.local')
    await expect(email.getByTestId('commit-email-current')).toHaveCount(0)
  })
})
