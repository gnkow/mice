import { test as base, expect } from '@playwright/test'
import { acceptConfirmModal } from '../fixtures'
import { uniqueId } from '../helpers/oxenApi'
import { mintSession } from '../helpers/session'

const BASE_URL = process.env.BOXEN_BASE_URL ?? 'http://localhost:5173'
const AUTH_URL = process.env.AUTH_URL ?? 'http://localhost:8080'

const test = base

async function sessionLogin(
  page: import('@playwright/test').Page,
  identity: {
    name: string
    email: string
    sub: string
    groups?: string[]
  },
) {
  await mintSession(page, { ...identity, iss: 'boxen-e2e' })
}

test.describe('authorization (PLAT-AUTHO)', () => {
  test('TC-AUTHO-api: create namespace + me/authz', async ({ page }) => {
    await sessionLogin(page, {
      name: 'AuthZ Admin',
      email: `admin-${uniqueId('e')}@boxen.local`,
      sub: uniqueId('autho-admin'),
    })

    const me = await page.request.get(`${AUTH_URL}/auth/me/authz`)
    expect(me.ok()).toBeTruthy()
    const authz = await me.json()
    expect(authz.instanceAdmin).toBeTruthy()

    const ns = uniqueId('autho-ns')
    const create = await page.request.post(`${AUTH_URL}/auth/namespaces`, {
      data: {
        name: ns,
        basePermission: 'none',
        membersCanCreateRepos: true,
      },
    })
    expect(create.ok()).toBeTruthy()
  })

  test('TC-AUTHO-collab: repo collaborators API', async ({ page }) => {
    await sessionLogin(page, {
      name: 'Collab Admin',
      email: `collab-${uniqueId('e')}@boxen.local`,
      sub: uniqueId('collab-admin'),
    })

    const ns = uniqueId('collab-ns')
    const repo = 'r1'
    await page.request.post(`${AUTH_URL}/auth/namespaces`, {
      data: { name: ns, basePermission: 'read' },
    })
    const createRepo = await page.request.post(`${AUTH_URL}/api/repos`, {
      data: { namespace: ns, name: repo },
    })
    expect(createRepo.ok()).toBeTruthy()

    const put = await page.request.put(
      `${AUTH_URL}/auth/namespaces/${encodeURIComponent(ns)}/repos/${encodeURIComponent(repo)}/collaborators`,
      { data: { sub: 'outsider', iss: 'boxen-e2e', role: 'write' } },
    )
    expect(put.ok()).toBeTruthy()
  })

  test('TC-AUTHO-group: IdP group member and collaborator', async ({
    page,
  }) => {
    const adminSub = uniqueId('grp-admin')
    await sessionLogin(page, {
      name: 'Group Admin',
      email: `grp-admin-${uniqueId('e')}@boxen.local`,
      sub: adminSub,
    })

    const ns = uniqueId('grp-ns')
    const repo = 'shared'
    await page.request.post(`${AUTH_URL}/auth/namespaces`, {
      data: { name: ns, basePermission: 'read' },
    })
    const createRepo = await page.request.post(`${AUTH_URL}/api/repos`, {
      data: { namespace: ns, name: repo },
    })
    expect(createRepo.ok()).toBeTruthy()

    const putMember = await page.request.put(
      `${AUTH_URL}/auth/namespaces/${encodeURIComponent(ns)}/members`,
      {
        data: {
          kind: 'group',
          group: 'boxen-readers',
          role: 'member',
        },
      },
    )
    expect(putMember.ok()).toBeTruthy()
    const membersBody = await putMember.json()
    expect(
      membersBody.members?.some(
        (m: { kind?: string; group?: string }) =>
          m.kind === 'group' && m.group === 'boxen-readers',
      ),
    ).toBeTruthy()

    const putCollab = await page.request.put(
      `${AUTH_URL}/auth/namespaces/${encodeURIComponent(ns)}/repos/${encodeURIComponent(repo)}/collaborators`,
      {
        data: {
          kind: 'group',
          group: 'boxen-writers',
          role: 'write',
        },
      },
    )
    expect(putCollab.ok()).toBeTruthy()

    // Group-only user clears hard gate and can read via member base permission
    await sessionLogin(page, {
      name: 'Group Reader',
      email: `grp-r-${uniqueId('e')}@boxen.local`,
      sub: uniqueId('grp-reader'),
      groups: ['boxen-readers'],
    })
    const me = await page.request.get(`${AUTH_URL}/auth/me/authz`)
    expect(me.ok()).toBeTruthy()
    const authz = await me.json()
    expect(authz.pending).toBeFalsy()

    const list = await page.request.get(
      `${AUTH_URL}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(repo)}`,
    )
    expect(list.ok()).toBeTruthy()
  })

  test('TC-AUTHO-09: cannot remove last Owner', async ({ page }) => {
    const sub = uniqueId('owner')
    await sessionLogin(page, {
      name: 'Solo Owner',
      email: `owner-${uniqueId('e')}@boxen.local`,
      sub,
    })
    const ns = uniqueId('solo-ns')
    await page.request.post(`${AUTH_URL}/auth/namespaces`, {
      data: { name: ns, basePermission: 'none' },
    })
    const del = await page.request.delete(
      `${AUTH_URL}/auth/namespaces/${encodeURIComponent(ns)}/members`,
      { data: { sub, iss: 'boxen-e2e' } },
    )
    expect(del.status()).toBe(400)
  })

  test('TC-AUTHO-access-request: submit request', async ({ page }) => {
    await sessionLogin(page, {
      name: 'Requester',
      email: `req-${uniqueId('e')}@boxen.local`,
      sub: uniqueId('req'),
    })
    const res = await page.request.post(`${AUTH_URL}/auth/access-requests`, {
      data: { message: 'need access for repository X' },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.request?.status).toBe('pending')
  })

  test('TC-AUTHO-access-review: admin approves from Settings', async ({
    page,
  }) => {
    const adminSub = uniqueId('rev-admin')
    await sessionLogin(page, {
      name: 'Review Admin',
      email: `rev-admin-${uniqueId('e')}@boxen.local`,
      sub: adminSub,
    })
    const ns = uniqueId('rev-ns')
    await page.request.post(`${AUTH_URL}/auth/namespaces`, {
      data: { name: ns, basePermission: 'read' },
    })

    const reqSub = uniqueId('rev-req')
    await sessionLogin(page, {
      name: 'Pending User',
      email: `rev-req-${uniqueId('e')}@boxen.local`,
      sub: reqSub,
    })
    const submit = await page.request.post(`${AUTH_URL}/auth/access-requests`, {
      data: { message: 'please add me' },
    })
    expect(submit.ok()).toBeTruthy()
    const submitted = await submit.json()
    const requestId = submitted.request?.id as string

    await sessionLogin(page, {
      name: 'Review Admin',
      email: `rev-admin-${uniqueId('e')}@boxen.local`,
      sub: adminSub,
    })
    const approve = await page.request.post(
      `${AUTH_URL}/auth/access-requests/${encodeURIComponent(requestId)}`,
      { data: { action: 'approve', namespace: ns, role: 'member' } },
    )
    expect(approve.ok()).toBeTruthy()

    await page.goto(`${BASE_URL}/settings`)
    await expect(
      page.getByRole('heading', { name: 'Access requests' }),
    ).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Instance admin' }),
    ).toBeVisible()
  })

  test('TC-AUTHO-custom-role: create repo role and assign', async ({
    page,
  }) => {
    await sessionLogin(page, {
      name: 'Custom Admin',
      email: `custom-${uniqueId('e')}@boxen.local`,
      sub: uniqueId('custom-admin'),
    })
    const ns = uniqueId('custom-ns')
    await page.request.post(`${AUTH_URL}/auth/namespaces`, {
      data: { name: ns, basePermission: 'none' },
    })
    const createRole = await page.request.post(
      `${AUTH_URL}/auth/namespaces/${encodeURIComponent(ns)}/custom-roles/repo`,
      {
        data: {
          name: 'Merger',
          base: 'write',
          permissions: ['merge'],
        },
      },
    )
    expect(createRole.ok()).toBeTruthy()
    const roleBody = await createRole.json()
    const roleId = roleBody.role?.id as string
    expect(roleId).toBeTruthy()

    const repo = 'r1'
    const createRepo = await page.request.post(`${AUTH_URL}/api/repos`, {
      data: { namespace: ns, name: repo },
    })
    expect(createRepo.ok()).toBeTruthy()

    const put = await page.request.put(
      `${AUTH_URL}/auth/namespaces/${encodeURIComponent(ns)}/repos/${encodeURIComponent(repo)}/collaborators`,
      {
        data: {
          sub: 'merger-user',
          iss: 'boxen-e2e',
          role: roleId,
        },
      },
    )
    expect(put.ok()).toBeTruthy()

    await page.goto(`${BASE_URL}/n/${encodeURIComponent(ns)}/settings`)
    await expect(
      page.getByRole('heading', { name: 'Custom roles' }),
    ).toBeVisible()
    await expect(page.getByText('Merger')).toBeVisible()
  })

  test('TC-AUTHO-ui: namespace Settings page loads', async ({ page }) => {
    const sub = uniqueId('ui-admin')
    await sessionLogin(page, {
      name: 'UI Admin',
      email: `ui-${uniqueId('e')}@boxen.local`,
      sub,
    })
    const ns = uniqueId('ui-ns')
    await page.request.post(`${AUTH_URL}/auth/namespaces`, {
      data: { name: ns, basePermission: 'none' },
    })
    await page.goto(`${BASE_URL}/n/${encodeURIComponent(ns)}/settings`)
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'General' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()
  })

  test('TC-AUTHO-training: self-complete training', async ({ page }) => {
    await sessionLogin(page, {
      name: 'Trainee',
      email: `train-${uniqueId('e')}@boxen.local`,
      sub: uniqueId('train'),
    })
    const res = await page.request.post(`${AUTH_URL}/auth/training`, {
      data: { completed: true },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.trainingCompleted).toBeTruthy()
  })

  test('TC-AUTHO-api: delete namespace', async ({ page }) => {
    await sessionLogin(page, {
      name: 'Ns Deleter',
      email: `del-${uniqueId('e')}@boxen.local`,
      sub: uniqueId('ns-del'),
    })
    const ns = uniqueId('del-ns')
    await page.request.post(`${AUTH_URL}/auth/namespaces`, {
      data: { name: ns, basePermission: 'none' },
    })
    const del = await page.request.delete(
      `${AUTH_URL}/auth/namespaces/${encodeURIComponent(ns)}`,
      { data: { deleteRepositories: true } },
    )
    expect(del.ok()).toBeTruthy()
    const get = await page.request.get(
      `${AUTH_URL}/auth/namespaces/${encodeURIComponent(ns)}`,
    )
    expect(get.status()).toBe(404)
  })

  test('TC-AUTHO-ui: new namespace page creates without repo', async ({
    page,
  }) => {
    await sessionLogin(page, {
      name: 'Ns Creator',
      email: `ns-${uniqueId('e')}@boxen.local`,
      sub: uniqueId('ns-creator'),
    })
    const ns = uniqueId('empty-ns')
    await page.goto(`${BASE_URL}/namespaces/new`)
    await expect(
      page.getByRole('heading', { name: 'New namespace' }),
    ).toBeVisible()
    await page.getByLabel('Name').fill(ns)
    await page.getByRole('button', { name: 'Create namespace' }).click()
    await expect(page).toHaveURL(new RegExp(`/n/${ns}/settings`))
    await page.goto(`${BASE_URL}/namespaces`)
    await expect(page.getByText(ns)).toBeVisible()
    await expect(page.getByText('Empty').first()).toBeVisible()
  })

  test('TC-AUTHO-ui: delete namespace from list', async ({ page }) => {
    await sessionLogin(page, {
      name: 'Ns Remover',
      email: `rm-${uniqueId('e')}@boxen.local`,
      sub: uniqueId('ns-rm'),
    })
    const ns = uniqueId('rm-ns')
    await page.request.post(`${AUTH_URL}/auth/namespaces`, {
      data: { name: ns, basePermission: 'none' },
    })
    await page.goto(`${BASE_URL}/namespaces`)
    const card = page.locator('article.ns-card').filter({ hasText: ns })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Delete' }).click()
    await acceptConfirmModal(page, ns)
    await expect(card).toHaveCount(0)
  })

  test('TC-AUTHO-pat-scopes: mint scoped PAT', async ({ page }) => {
    await sessionLogin(page, {
      name: 'Pat User',
      email: `pat-${uniqueId('e')}@boxen.local`,
      sub: uniqueId('pat'),
    })
    const res = await page.request.post(`${AUTH_URL}/auth/tokens`, {
      data: {
        label: 'scoped',
        scopes: [{ namespace: 'demo', maxRole: 'read' }],
      },
    })
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.token).toMatch(/^boxen_pat_/)
    expect(body.pat?.scopes?.[0]?.namespace).toBe('demo')
  })

  test('TC-AUTHO-access-deny: admin denies request', async ({ page }) => {
    const adminSub = uniqueId('deny-admin')
    await sessionLogin(page, {
      name: 'Deny Admin',
      email: `deny-admin-${uniqueId('e')}@boxen.local`,
      sub: adminSub,
    })

    const reqSub = uniqueId('deny-req')
    await sessionLogin(page, {
      name: 'Denied User',
      email: `deny-req-${uniqueId('e')}@boxen.local`,
      sub: reqSub,
    })
    const submit = await page.request.post(`${AUTH_URL}/auth/access-requests`, {
      data: { message: 'please deny me' },
    })
    expect(submit.ok()).toBeTruthy()
    const requestId = (await submit.json()).request?.id as string

    await sessionLogin(page, {
      name: 'Deny Admin',
      email: `deny-admin-${uniqueId('e')}@boxen.local`,
      sub: adminSub,
    })
    const deny = await page.request.post(
      `${AUTH_URL}/auth/access-requests/${encodeURIComponent(requestId)}`,
      { data: { action: 'deny' } },
    )
    expect(deny.ok()).toBeTruthy()
    const body = await deny.json()
    expect(body.request?.status).toBe('denied')
  })

  test('TC-AUTHO-instance: permissions and enforce toggle', async ({
    page,
  }) => {
    const adminSub = uniqueId('inst-admin')
    await sessionLogin(page, {
      name: 'Instance Admin',
      email: `inst-${uniqueId('e')}@boxen.local`,
      sub: adminSub,
    })

    const get = await page.request.get(`${AUTH_URL}/auth/instance`)
    expect(get.ok()).toBeTruthy()
    const before = await get.json()
    expect(before).toHaveProperty('enforce')

    const targetSub = uniqueId('inst-target')
    const putPerms = await page.request.put(
      `${AUTH_URL}/auth/instance/permissions`,
      {
        data: {
          sub: targetSub,
          iss: 'boxen-e2e',
          permissions: ['create_namespace', 'view_audit'],
        },
      },
    )
    expect(putPerms.ok()).toBeTruthy()

    const addAdmin = await page.request.post(`${AUTH_URL}/auth/instance/admins`, {
      data: { sub: uniqueId('extra-admin'), iss: 'boxen-e2e' },
    })
    expect(addAdmin.ok()).toBeTruthy()

    const patch = await page.request.patch(`${AUTH_URL}/auth/instance`, {
      data: { enforce: Boolean(before.enforce) },
    })
    expect(patch.ok()).toBeTruthy()
  })

  test('TC-AUTHO-custom-ns-role: create namespace role and assign', async ({
    page,
  }) => {
    await sessionLogin(page, {
      name: 'Ns Role Admin',
      email: `nsrole-${uniqueId('e')}@boxen.local`,
      sub: uniqueId('nsrole-admin'),
    })
    const ns = uniqueId('nsrole-ns')
    await page.request.post(`${AUTH_URL}/auth/namespaces`, {
      data: { name: ns, basePermission: 'none' },
    })
    const createRole = await page.request.post(
      `${AUTH_URL}/auth/namespaces/${encodeURIComponent(ns)}/custom-roles/namespace`,
      {
        data: {
          name: 'Auditor',
          permissions: ['view_audit', 'review_access_requests'],
          baseRepositoryRole: 'read',
        },
      },
    )
    expect(createRole.ok()).toBeTruthy()
    const roleId = (await createRole.json()).role?.id as string
    expect(roleId).toBeTruthy()

    const put = await page.request.put(
      `${AUTH_URL}/auth/namespaces/${encodeURIComponent(ns)}/members`,
      {
        data: {
          sub: 'auditor-user',
          iss: 'boxen-e2e',
          role: roleId,
        },
      },
    )
    expect(put.ok()).toBeTruthy()

    await page.goto(`${BASE_URL}/n/${encodeURIComponent(ns)}/settings`)
    await expect(
      page.getByRole('heading', { name: 'Custom roles' }),
    ).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Custom roles' }).getByText('Auditor'),
    ).toBeVisible()
  })

  test('TC-AUTHO-ns-settings: patch base permission', async ({ page }) => {
    await sessionLogin(page, {
      name: 'Settings Admin',
      email: `set-${uniqueId('e')}@boxen.local`,
      sub: uniqueId('set-admin'),
    })
    const ns = uniqueId('set-ns')
    await page.request.post(`${AUTH_URL}/auth/namespaces`, {
      data: { name: ns, basePermission: 'none', membersCanCreateRepos: true },
    })
    const patch = await page.request.patch(
      `${AUTH_URL}/auth/namespaces/${encodeURIComponent(ns)}`,
      {
        data: {
          basePermission: 'read',
          membersCanCreateRepos: false,
        },
      },
    )
    expect(patch.ok()).toBeTruthy()
    const get = await page.request.get(
      `${AUTH_URL}/auth/namespaces/${encodeURIComponent(ns)}`,
    )
    expect(get.ok()).toBeTruthy()
    const body = await get.json()
    expect(body.basePermission).toBe('read')
    expect(body.membersCanCreateRepos).toBe(false)
  })

  test('TC-AUTHO-collab-remove: delete collaborator', async ({ page }) => {
    await sessionLogin(page, {
      name: 'Collab Remover',
      email: `crm-${uniqueId('e')}@boxen.local`,
      sub: uniqueId('crm-admin'),
    })
    const ns = uniqueId('crm-ns')
    const repo = 'r1'
    await page.request.post(`${AUTH_URL}/auth/namespaces`, {
      data: { name: ns, basePermission: 'read' },
    })
    const createRepo = await page.request.post(`${AUTH_URL}/api/repos`, {
      data: { namespace: ns, name: repo },
    })
    expect(createRepo.ok()).toBeTruthy()
    await page.request.put(
      `${AUTH_URL}/auth/namespaces/${encodeURIComponent(ns)}/repos/${encodeURIComponent(repo)}/collaborators`,
      { data: { sub: 'temp-collab', iss: 'boxen-e2e', role: 'write' } },
    )
    const del = await page.request.delete(
      `${AUTH_URL}/auth/namespaces/${encodeURIComponent(ns)}/repos/${encodeURIComponent(repo)}/collaborators`,
      { data: { sub: 'temp-collab', iss: 'boxen-e2e' } },
    )
    expect(del.ok()).toBeTruthy()
  })

  test('TC-AUTHO-access-approve-perm: grant create_namespace', async ({
    page,
  }) => {
    const adminSub = uniqueId('perm-admin')
    await sessionLogin(page, {
      name: 'Perm Admin',
      email: `perm-admin-${uniqueId('e')}@boxen.local`,
      sub: adminSub,
    })

    const reqSub = uniqueId('perm-req')
    await sessionLogin(page, {
      name: 'Perm Requester',
      email: `perm-req-${uniqueId('e')}@boxen.local`,
      sub: reqSub,
    })
    const submit = await page.request.post(`${AUTH_URL}/auth/access-requests`, {
      data: { message: 'need create_namespace' },
    })
    expect(submit.ok()).toBeTruthy()
    const requestId = (await submit.json()).request?.id as string

    await sessionLogin(page, {
      name: 'Perm Admin',
      email: `perm-admin-${uniqueId('e')}@boxen.local`,
      sub: adminSub,
    })
    const approve = await page.request.post(
      `${AUTH_URL}/auth/access-requests/${encodeURIComponent(requestId)}`,
      {
        data: {
          action: 'approve',
          permission: 'create_namespace',
        },
      },
    )
    expect(approve.ok()).toBeTruthy()
    expect((await approve.json()).request?.status).toBe('approved')
  })

  test('TC-AUTHO-directory: store search + Settings add member', async ({
    page,
  }) => {
    const adminSub = uniqueId('dir-admin')
    await sessionLogin(page, {
      name: 'Directory Admin',
      email: `dir-admin-${uniqueId('e')}@boxen.local`,
      sub: adminSub,
    })

    const ns = uniqueId('dir-ns')
    const memberSub = uniqueId('dir-member')
    await page.request.post(`${AUTH_URL}/auth/namespaces`, {
      data: { name: ns, basePermission: 'read' },
    })
    await page.request.put(
      `${AUTH_URL}/auth/namespaces/${encodeURIComponent(ns)}/members`,
      {
        data: {
          kind: 'user',
          sub: memberSub,
          iss: 'boxen-e2e',
          role: 'member',
        },
      },
    )

    const search = await page.request.get(
      `${AUTH_URL}/auth/directory/search?q=${encodeURIComponent(memberSub)}&kind=user`,
    )
    expect(search.ok()).toBeTruthy()
    const body = await search.json()
    expect(
      (body.results as Array<{ kind: string; sub: string }>).some(
        (r) => r.kind === 'user' && r.sub === memberSub,
      ),
    ).toBeTruthy()

    await page.goto(`${BASE_URL}/n/${encodeURIComponent(ns)}/settings`)
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible()
    const searchBox = page.getByPlaceholder('Name, email, or username')
    await searchBox.fill(memberSub)
    await expect(
      page.locator('.directory-picker-option').filter({ hasText: memberSub }),
    ).toBeVisible({ timeout: 10_000 })
    await page
      .locator('.directory-picker-option')
      .filter({ hasText: memberSub })
      .first()
      .click()
    await expect(page.getByText(`Selected:`)).toBeVisible()
  })
})
