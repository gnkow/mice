import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { test, expect } from '../fixtures'

const exec = promisify(execFile)

test.describe('workspaces (overlay checkouts)', () => {
  test('unnamed workspaces coexist; session mounts are distinct and writable by the guest', async ({ page, seededRepo }) => {
    test.setTimeout(240_000)
    const ids: string[] = []
    let sessionId = ''
    try {
      for (const name of ['main', undefined, '']) {
        const response = await page.request.post('/auth/workspaces', {
          data: { namespace: seededRepo.namespace, repo: seededRepo.repo, name, source: { branch: 'main' } },
        })
        expect(response.status()).toBe(202)
        ids.push((await response.json()).workspace.id)
      }
      for (const id of ids) {
        await expect.poll(async () => (await (await page.request.get(`/auth/workspaces/${id}`)).json()).workspace.status, { timeout: 90_000 }).toBe('ready')
        const ws = (await (await page.request.get(`/auth/workspaces/${id}`)).json()).workspace
        expect(ws.name).toBe(id === ids[0] ? 'main' : `${id}-main-${ws.base_commit.slice(0, 8)}`)
      }
      const response = await page.request.post('/auth/sessions', {
        data: { mounts: ids.slice(1).map((workspace_id) => ({ workspace_id, mount_mode: 'rw' })) },
      })
      expect(response.ok()).toBeTruthy()
      sessionId = (await response.json()).session.id
      await expect.poll(async () => (await (await page.request.get(`/auth/sessions/${sessionId}`)).json()).session.status, { timeout: 120_000 }).toBe('ready')
      const session = (await (await page.request.get(`/auth/sessions/${sessionId}`)).json()).session
      const [a, b] = session.mounts as { workspace_id: string; mount_path: string; effective_mode: string }[]
      expect(a!.mount_path).not.toBe(b!.mount_path)
      expect(a!.effective_mode).toBe('rw')
      expect(b!.effective_mode).toBe('rw')
      if (session.endpoints?.container_name) {
        await exec('docker', [
          'exec', '--user', '1000:1000', session.endpoints.container_name, 'sh', '-ec',
          'mkdir "$1/new-dir"; printf changed > "$1/readme.txt"; mv "$1/readme.txt" "$1/renamed.txt"; rm "$1/renamed.txt"; printf new > "$1/new-dir/file"; test "$(cat "$2/readme.txt")" = "hello from e2e"; test ! -e "$2/new-dir"',
          '_', a!.mount_path, b!.mount_path,
        ])
      }
      await page.goto(`/sessions/${sessionId}`)
      const row = page.locator(`tr[data-workspace="${a!.workspace_id}"]`)
      const access = row.getByRole('combobox', { name: `Access for workspace ${a!.workspace_id}` })
      await access.selectOption('ro')
      await page.getByRole('button', { name: 'Confirm' }).click()
      await expect(access).toHaveValue('ro')
      await expect(access).toBeEnabled({ timeout: 120_000 })
      const updated = (await (await page.request.get(`/auth/sessions/${sessionId}`)).json()).session
      expect(updated.mounts[0].effective_mode).toBe('ro')
      if (updated.endpoints?.container_name) {
        await exec('docker', [
          'exec', '--user', '1000:1000', updated.endpoints.container_name, 'sh', '-ec',
          'if touch "$1/forbidden" 2>/dev/null; then exit 1; fi; printf writable > "$2/still-writable"',
          '_', a!.mount_path, b!.mount_path,
        ])
      }
    } finally {
      if (sessionId) await page.request.delete(`/auth/sessions/${sessionId}`)
      for (const id of ids) {
        await expect.poll(async () => (await page.request.delete(`/auth/workspaces/${id}`)).status(), { timeout: 60_000 }).toBe(200)
      }
    }
  })

  test('TC-WS-UI-02: create from a commit', async ({ page, seededRepo }) => {
    const wsName = `e2e-commit-${Date.now().toString(36)}`
    await page.goto('/workspaces')
    await page.getByRole('button', { name: 'New workspace' }).click()
    const dialog = page.getByRole('dialog', { name: 'New workspace' })
    await dialog.getByLabel('Repository').selectOption(`${seededRepo.namespace}/${seededRepo.repo}`)
    await dialog.getByLabel('Source type').selectOption('commit')
    await expect(dialog.getByLabel('Commit', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(dialog.getByLabel('Commit', { exact: true }).locator('option').first()).toBeAttached({ timeout: 15_000 })
    await dialog.getByLabel('Workspace name').fill(wsName)
    await dialog.getByRole('button', { name: 'Create workspace' }).click()
    const row = page.locator('tr[data-workspace]', { hasText: wsName })
    await expect(row.locator('.pill', { hasText: /^ready$/ })).toBeVisible({ timeout: 90_000 })
    await expect(row).toContainText('commit @')
    await row.getByRole('button', { name: /^Delete workspace/ }).click()
    await page.getByRole('dialog').getByRole('textbox').fill(wsName)
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click()
    await expect(row).toHaveCount(0, { timeout: 15_000 })
  })

  test('TC-WS-UI-01: create, becomes ready, delete', async ({ page, seededRepo }) => {
    const wsName = `e2e-overlay-${Date.now().toString(36)}`
    await page.goto('/workspaces')
    await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'New workspace' }).click()
    const dialog = page.getByRole('dialog', { name: 'New workspace' })
    await dialog.getByLabel('Repository').selectOption(`${seededRepo.namespace}/${seededRepo.repo}`)
    await expect(dialog.getByLabel('Source branch').locator('option').first()).toBeAttached({ timeout: 15_000 })
    await dialog.getByLabel('Workspace name').fill(wsName)
    await dialog.getByRole('button', { name: 'Create workspace' }).click()

    const row = page.locator('tr[data-workspace]', { hasText: wsName })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await expect(row.locator('.pill', { hasText: /^ready$/ })).toBeVisible({ timeout: 90_000 })
    await expect(row).toContainText('No changes')

    await row.locator('.workspace-name-link').click()
    await expect(page.getByRole('heading', { name: wsName })).toBeVisible()
    await expect(page.getByText('No changes.')).toBeVisible({ timeout: 30_000 })
    for (const t of ['Jobs', 'Sessions', 'Changes']) {
      await page.getByRole('tab', { name: t }).click()
      await expect(page.getByRole('tab', { name: t })).toHaveAttribute('aria-selected', 'true')
    }
    await page.getByRole('link', { name: '← Workspaces' }).click()
    await row.getByRole('link', { name: /^Sessions of workspace/ }).click()
    await expect(page.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('link', { name: '← Workspaces' }).click()
    await row.getByRole('link', { name: /^Jobs of workspace/ }).click()
    await expect(page.getByRole('tab', { name: 'Jobs' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('link', { name: '← Workspaces' }).click()

    await row.getByRole('button', { name: /^Delete workspace/ }).click()
    await page.getByRole('dialog').getByRole('textbox').fill(wsName)
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click()
    await expect(row).toHaveCount(0, { timeout: 15_000 })
  })

  test('TC-WS-UI-03: mount a workspace into a session', async ({ page, seededRepo }) => {
    const base = `/n/${seededRepo.namespace}/r/${seededRepo.repo}`
    const created = await page.request.post('/auth/workspaces', {
      data: { namespace: seededRepo.namespace, repo: seededRepo.repo, name: `e2e-sess-${Date.now().toString(36)}`, source: { branch: 'main' } },
    })
    expect(created.ok()).toBeTruthy()
    const wsId = ((await created.json()) as { workspace: { id: string } }).workspace.id
    let sessionId = ''
    try {
      await expect
        .poll(async () => ((await (await page.request.get(`/auth/workspaces/${wsId}`)).json()) as { workspace: { status: string } }).workspace.status, { timeout: 90_000 })
        .toBe('ready')

      // Earlier specs leave sessions behind; free the per-user session slots.
      const existing = (await (await page.request.get('/auth/sessions')).json()) as { sessions: { id: string; status: string }[] }
      for (const s of existing.sessions.filter((x) => !['stopped', 'destroyed', 'failed'].includes(x.status))) {
        await page.request.delete(`/auth/sessions/${s.id}`)
      }
      await page.goto('/sessions')
      await page.getByRole('button', { name: 'New session' }).click()
      const dialog = page.getByRole('dialog', { name: 'New session' })
      await dialog.getByLabel('Workspace 1', { exact: true }).selectOption(wsId)
      await dialog.getByRole('button', { name: 'Create session' }).click()
      await expect(dialog.locator('p.error')).toHaveCount(0, { timeout: 3_000 }).catch(async () => {
        throw new Error(`create failed: ${await dialog.locator('p.error').innerText()}`)
      })
      await expect(page).toHaveURL(/\/sessions\/[0-9a-f]+/, { timeout: 60_000 })
      sessionId = page.url().split('/sessions/')[1]!.split(/[?#]/)[0]!
      await expect(page.locator(`tr[data-workspace="${wsId}"]`)).toBeVisible()

      // Edit mounts from the session page: switch to read-only, unmount, mount again.
      const row = page.locator(`tr[data-workspace="${wsId}"]`)
      await expect(row.getByRole('combobox', { name: `Access for workspace ${wsId}` })).toBeEnabled({ timeout: 90_000 })
      await row.getByRole('combobox', { name: `Access for workspace ${wsId}` }).selectOption('ro')
      await page.getByRole('button', { name: 'Confirm' }).click()
      await expect(row.getByRole('combobox', { name: `Access for workspace ${wsId}` })).toHaveValue('ro', { timeout: 30_000 })
      await row.getByRole('button', { name: /Unmount workspace/ }).click()
      await page.getByRole('button', { name: 'Confirm' }).click()
      await expect(row).toHaveCount(0, { timeout: 30_000 })
      await expect(page.getByRole('button', { name: 'Mount workspace' })).toBeEnabled({ timeout: 60_000 })
      await page.getByRole('button', { name: 'Mount workspace' }).click()
      const mountDialog = page.getByRole('dialog', { name: 'Mount workspace' })
      await mountDialog.getByLabel('Workspace', { exact: true }).selectOption(wsId)
      await mountDialog.getByLabel('Access').selectOption('ro')
      await mountDialog.getByRole('button', { name: 'Mount workspace' }).click()
      await expect(page.locator(`tr[data-workspace="${wsId}"]`)).toBeVisible({ timeout: 30_000 })

      await page.goto(`${base}/workspaces/${wsId}?tab=sessions`)
      await expect(page.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true')
      await expect(page.locator('a[href^="/sessions/"]').first()).toBeVisible({ timeout: 15_000 })
    } finally {
      if (sessionId) await page.request.delete(`/auth/sessions/${sessionId}`)
      await expect
        .poll(async () => (await page.request.delete(`/auth/workspaces/${wsId}`)).status(), { timeout: 60_000 })
        .toBe(200)
    }
  })
})
