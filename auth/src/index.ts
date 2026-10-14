import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { env, oidcConfigured } from './env.js'
import {
  buildAuthorizeUrl,
  buildEndSessionUrl,
  exchangeCode,
  loadOidcConfig,
  pkceChallenge,
  randomString,
} from './oidc.js'
import { proxyToOxen } from './proxy.js'
import {
  clearSessionCookie,
  getSession,
  setSessionCookie,
  type PatScope,
  type SessionUser,
} from './session.js'
import {
  actorFromUser,
  appendAudit,
  queryAudit,
} from './audit.js'
import {
  canReviewAccessRequests,
  listAccessRequests,
  resolveAccessRequest,
  submitAccessRequest,
} from './accessRequests.js'
import {
  authorizeAuditQuery,
  canManageRepoCollaborators,
  isPendingUser,
  preparePrincipal,
} from './authz.js'
import {
  canSearchDirectory,
  searchDirectory,
} from './directory.js'
import {
  addInstanceAdmin,
  createNamespaceAuthz,
  deleteNamespaceAuthz,
  getNamespace,
  hasInstancePermission,
  hasNamespaceCapability,
  isAuthzEnforce,
  isCustomNamespaceRoleAssigned,
  isCustomRepoRoleAssigned,
  isInstanceAdmin,
  listInstanceAdmins,
  listInstancePermissionGrants,
  listNamespaceMembers,
  listNamespacesForUser,
  listRepoCollaborators,
  namespacesWithCapability,
  removeInstanceAdmin,
  removeNamespaceGroupMember,
  removeNamespaceMember,
  removeRepoCollaborator,
  removeRepoGroupCollaborator,
  resolveNamespaceRole,
  setAuthzEnforce,
  setInstancePermissions,
  setNamespaceGroupMember,
  setNamespaceMember,
  setRepoCollaborator,
  setRepoGroupCollaborator,
  setTrainingCompleted,
  setTrainingCompletedSelf,
  hasCompletedTraining,
  updateNamespaceSettings,
  userHasAnyGrant,
} from './authzStore.js'
import {
  ALL_NAMESPACE_CAPABILITIES,
  ALL_REPO_FINE_PERMISSIONS,
  REPO_FINE_IMPLIED_MIN,
  createCustomNamespaceRole,
  createCustomRepoRole,
  deleteCustomNamespaceRole,
  deleteCustomRepoRole,
  listCustomNamespaceRoles,
  listCustomRepoRoles,
  updateCustomNamespaceRole,
  updateCustomRepoRole,
} from './customRoles.js'
import type {
  BasePermission,
  CollaboratorRoleRef,
  InstancePermission,
  MemberRoleRef,
  NamespaceCapability,
  RepoFinePermission,
} from './authzTypes.js'
import { createPat, listPatsForUser, resolvePat, revokePat } from './tokens.js'

const PKCE_COOKIE = 'boxen_oidc_pkce'
/** After Boxen logout, next /auth/login must show IdP credentials (no silent SSO). */
const PROMPT_LOGIN_COOKIE = 'boxen_prompt_login'

type PkceState = {
  verifier: string
  state: string
  nonce: string
}

const app = new Hono()

app.get('/healthz', (c) => c.json({ ok: true }))

/** Public CLI remote hint (no secrets). */
app.get('/auth/cli-info', (c) => {
  const remote = env.publicOxenRemote
  let authHost = remote
  try {
    const u = new URL(remote)
    authHost = u.host
  } catch {
    /* keep remote */
  }
  return c.json({
    remote,
    authHost,
    configExample: `oxen config --auth ${authHost} <PAT>`,
    cloneExample: `oxen clone ${remote}/<namespace>/<repo>`,
  })
})

app.get('/auth/me', async (c) => {
  const session = await getSession(c)
  if (!session) return c.json({ authenticated: false }, 401)
  preparePrincipal(session)
  return c.json({
    authenticated: true,
    user: {
      sub: session.sub,
      iss: session.iss,
      email: session.email,
      name: session.name,
    },
  })
})

/** Effective AuthZ summary for UI (pending gate, instance flags). */
app.get('/auth/me/authz', async (c) => {
  const session = await getSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  const pending = isPendingUser(session)
  return c.json({
    enforce: isAuthzEnforce(),
    pending,
    instanceAdmin: isInstanceAdmin(session),
    permissions: {
      create_namespace: hasInstancePermission(session, 'create_namespace'),
      view_audit: hasInstancePermission(session, 'view_audit'),
      manage_breakglass: hasInstancePermission(session, 'manage_breakglass'),
    },
    hasAnyGrant: userHasAnyGrant(session),
    trainingCompleted: hasCompletedTraining(session),
    requireTraining: env.authzRequireTraining,
  })
})

/** IdP / store directory search for AuthZ member & collaborator pickers. */
app.get('/auth/directory/search', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  if (!canSearchDirectory(session)) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const q = c.req.query('q') ?? ''
  const kindRaw = (c.req.query('kind') ?? 'user').toLowerCase()
  const kind = kindRaw === 'group' ? 'group' : 'user'
  const limitRaw = Number(c.req.query('limit') ?? 25)
  const result = await searchDirectory({
    q,
    kind,
    limit: Number.isFinite(limitRaw) ? limitRaw : 25,
  })
  return c.json(result)
})

app.post('/auth/access-requests', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  let message = ''
  try {
    const body = (await c.req.json()) as { message?: string }
    message = body.message ?? ''
  } catch {
    /* ok */
  }
  const req = submitAccessRequest(session, message)
  return c.json({ ok: true, request: req })
})

app.get('/auth/access-requests', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  if (!canReviewAccessRequests(session)) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const fullHistory =
    isInstanceAdmin(session) ||
    hasInstancePermission(session, 'create_namespace')
  return c.json({
    requests: listAccessRequests({ pendingOnly: !fullHistory }),
    reviewNamespaces: namespacesWithCapability(
      session,
      'review_access_requests',
    ),
  })
})

app.post('/auth/access-requests/:id', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  let body: {
    action?: 'approve' | 'deny'
    namespace?: string
    role?: MemberRoleRef
    permission?: InstancePermission
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  if (body.action !== 'approve' && body.action !== 'deny') {
    return c.json({ error: 'action required' }, 400)
  }
  const result = resolveAccessRequest(session, c.req.param('id'), body.action, {
    namespace: body.namespace,
    role: body.role,
    permission: body.permission,
  })
  if (!result.ok) return c.json({ error: result.error }, 400)
  return c.json({ ok: true, request: result.request })
})

app.post('/auth/training', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  let body: { sub?: string; iss?: string; completed?: boolean }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  const done = body.completed !== false
  const target = {
    sub: body.sub ?? session.sub,
    iss: body.iss ?? session.iss,
  }
  const self = target.sub === session.sub && target.iss === session.iss
  if (self) {
    setTrainingCompletedSelf(session, done)
  } else {
    const result = setTrainingCompleted(session, target, done)
    if (!result.ok) return c.json({ error: result.error }, 403)
  }
  return c.json({
    ok: true,
    trainingCompleted: hasCompletedTraining(target),
  })
})

async function requireSession(c: Parameters<typeof getSession>[0]) {
  const session = await getSession(c)
  if (!session) return null
  return session
}

app.get('/auth/tokens', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  return c.json({ tokens: listPatsForUser(session) })
})

app.post('/auth/tokens', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  let label = 'CLI token'
  let scopes: PatScope[] | undefined
  try {
    const body = (await c.req.json()) as {
      label?: string
      scopes?: PatScope[]
    }
    if (body.label?.trim()) label = body.label.trim()
    if (Array.isArray(body.scopes) && body.scopes.length) scopes = body.scopes
  } catch {
    /* empty body ok */
  }
  const { token, pat } = createPat(session, label, scopes)
  let authHost = env.publicOxenRemote
  try {
    authHost = new URL(env.publicOxenRemote).host
  } catch {
    /* keep */
  }
  return c.json({
    token,
    pat,
    cli: {
      remote: env.publicOxenRemote,
      config: `oxen config --auth ${authHost} ${token}`,
    },
  })
})

app.delete('/auth/tokens/:id', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const id = c.req.param('id')
  const ok = revokePat(session, id)
  if (!ok) return c.json({ error: 'Token not found' }, 404)
  return c.json({ ok: true })
})

/** Query append-only audit log (session or breakglass). */
app.get('/auth/audit', async (c) => {
  const session = await getSession(c)
  const auth = c.req.header('authorization') ?? ''
  const breakglassOk =
    Boolean(env.breakglassToken) &&
    auth === `Bearer ${env.breakglassToken}`
  if (!session && !breakglassOk) {
    return c.json({ error: 'Authentication required' }, 401)
  }

  let namespace = c.req.query('namespace') || undefined
  let ownedOnly: string[] | undefined
  if (session) {
    preparePrincipal(session)
    const gate = authorizeAuditQuery(session, namespace)
    if (!gate.allow) {
      return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
    }
    if (gate.forceNamespace) namespace = gate.forceNamespace
    ownedOnly = gate.ownedOnly
  }

  const limitRaw = c.req.query('limit')
  const limit = limitRaw ? Number(limitRaw) : undefined
  const { events, nextCursor } = queryAudit({
    actor: c.req.query('actor') || undefined,
    namespace,
    repo: c.req.query('repo') || undefined,
    action: c.req.query('action') || undefined,
    since: c.req.query('since') || undefined,
    until: c.req.query('until') || undefined,
    cursor: c.req.query('cursor') || undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  })
  const filtered =
    ownedOnly && ownedOnly.length
      ? events.filter((e) => e.namespace && ownedOnly.includes(e.namespace))
      : events
  return c.json({ events: filtered, nextCursor })
})

app.post('/auth/dev-login', async (c) => {
  if (!env.authDevMode) {
    return c.json({ error: 'AUTH_DEV_MODE is disabled' }, 404)
  }
  let override: Partial<SessionUser> = {}
  try {
    override = (await c.req.json()) as Partial<SessionUser>
  } catch {
    /* empty body ok */
  }
  const groups = Array.isArray(override.groups)
    ? override.groups
        .filter((g): g is string => typeof g === 'string')
        .map((g) => g.trim().toLowerCase())
        .filter(Boolean)
    : undefined
  const user: SessionUser = {
    sub: override.sub || env.devUser.sub,
    iss: override.iss || env.devUser.iss,
    email: override.email || env.devUser.email,
    name: override.name || env.devUser.name,
    ...(groups?.length ? { groups } : {}),
  }
  preparePrincipal(user)
  await setSessionCookie(c, user)
  deleteCookie(c, PROMPT_LOGIN_COOKIE, { path: '/' })
  return c.json({ ok: true, user })
})

app.get('/auth/login', async (c) => {
  if (!oidcConfigured()) {
    if (env.authDevMode) {
      return c.redirect('/auth/dev-login-page')
    }
    return c.json({ error: 'OIDC is not configured' }, 503)
  }
  await loadOidcConfig()
  const verifier = randomString(32)
  const state = randomString(16)
  const nonce = randomString(16)
  const challenge = await pkceChallenge(verifier)
  const pkce: PkceState = { verifier, state, nonce }
  setCookie(c, PKCE_COOKIE, Buffer.from(JSON.stringify(pkce)).toString('base64url'), {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: 600,
  })
  // Always prompt=login so Sign in with SSO shows the IdP credential form
  // (covers Keycloak SSO cookies that survived Boxen-only logout).
  deleteCookie(c, PROMPT_LOGIN_COOKIE, { path: '/' })
  return c.redirect(
    buildAuthorizeUrl({
      state,
      nonce,
      codeChallenge: challenge,
      promptLogin: true,
    }),
  )
})

/** Tiny HTML form when OIDC is off but DEV mode is on (manual browser login). */
app.get('/auth/dev-login-page', async (c) => {
  if (!env.authDevMode) return c.text('Not found', 404)
  return c.html(`<!doctype html>
<html><head><meta charset="utf-8"><title>Boxen dev login</title></head>
<body>
  <h1>Boxen dev login</h1>
  <p>AUTH_DEV_MODE is enabled (no IdP).</p>
  <button id="go">Sign in as ${env.devUser.name}</button>
  <script>
    document.getElementById('go').onclick = async () => {
      await fetch('/auth/dev-login', { method: 'POST', credentials: 'same-origin' })
      location.href = '/'
    }
  </script>
</body></html>`)
})

app.get('/auth/callback', async (c) => {
  if (!oidcConfigured()) return c.json({ error: 'OIDC is not configured' }, 503)
  const code = c.req.query('code')
  const state = c.req.query('state')
  const err = c.req.query('error')
  if (err) {
    return c.html(`<p>Login failed: ${err}</p><p><a href="/auth/login">Retry</a></p>`, 400)
  }
  const raw = getCookie(c, PKCE_COOKIE)
  deleteCookie(c, PKCE_COOKIE, {
    path: '/',
    secure: env.cookieSecure,
    sameSite: 'Lax',
  })
  if (!code || !state || !raw) {
    return c.html('<p>Missing OIDC state. <a href="/auth/login">Retry</a></p>', 400)
  }
  let pkce: PkceState
  try {
    pkce = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as PkceState
  } catch {
    return c.html('<p>Invalid OIDC state. <a href="/auth/login">Retry</a></p>', 400)
  }
  if (pkce.state !== state) {
    return c.html('<p>State mismatch. <a href="/auth/login">Retry</a></p>', 400)
  }
  try {
    const user = await exchangeCode({
      code,
      codeVerifier: pkce.verifier,
    })
    const sessionUser: SessionUser = {
      sub: user.sub,
      iss: user.iss,
      email: user.email,
      name: user.name,
      idToken: user.idToken,
      ...(user.groups.length ? { groups: user.groups } : {}),
    }
    preparePrincipal(sessionUser)
    await setSessionCookie(c, sessionUser)
    return c.redirect('/')
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'login failed'
    return c.html(`<p>${msg}</p><p><a href="/auth/login">Retry</a></p>`, 500)
  }
})

async function finishLogout(c: Parameters<typeof getSession>[0]) {
  const session = await getSession(c)
  clearSessionCookie(c)
  setCookie(c, PROMPT_LOGIN_COOKIE, '1', {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: 600,
  })

  // Only RP-initiated IdP logout when we have a real OIDC id_token (not AUTH_DEV_MODE).
  let idpLogoutUrl: string | null = null
  if (session?.idToken && oidcConfigured()) {
    try {
      idpLogoutUrl = await buildEndSessionUrl({ idToken: session.idToken })
    } catch {
      idpLogoutUrl = null
    }
  }
  return idpLogoutUrl
}

app.post('/auth/logout', async (c) => {
  const idpLogoutUrl = await finishLogout(c)
  return c.json({ ok: true, idpLogoutUrl })
})

app.get('/auth/logout', async (c) => {
  const idpLogoutUrl = await finishLogout(c)
  if (idpLogoutUrl) return c.redirect(idpLogoutUrl)
  return c.redirect('/login')
})

async function requireAuth(c: Parameters<typeof proxyToOxen>[0]) {
  const session = await getSession(c)
  if (session) {
    preparePrincipal(session)
    return { user: session as SessionUser, via: 'session' as const }
  }

  const auth = c.req.header('authorization') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''

  if (bearer) {
    const patUser = resolvePat(bearer)
    if (patUser) {
      preparePrincipal(patUser)
      return { user: patUser, via: 'pat' as const }
    }
  }

  if (env.breakglassToken && auth === `Bearer ${env.breakglassToken}`) {
    return {
      user: {
        sub: 'breakglass',
        iss: 'boxen-breakglass',
        email: 'breakglass@boxen.local',
        name: 'Breakglass',
      } satisfies SessionUser,
      via: 'breakglass' as const,
    }
  }
  return null
}

function requireOwner(session: SessionUser, ns: string): boolean {
  preparePrincipal(session)
  if (isInstanceAdmin(session)) return true
  return resolveNamespaceRole(ns, session) === 'owner'
}

function requireNsCapability(
  session: SessionUser,
  ns: string,
  cap: NamespaceCapability,
): boolean {
  preparePrincipal(session)
  return hasNamespaceCapability(ns, session, cap)
}

// --- AuthZ admin APIs (PLAT-AUTHO) ---

app.get('/auth/instance', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  if (!isInstanceAdmin(session)) return c.json({ error: 'Forbidden' }, 403)
  return c.json({
    enforce: isAuthzEnforce(),
    admins: listInstanceAdmins(),
    permissions: listInstancePermissionGrants(),
    devMode: env.authDevMode,
  })
})

app.patch('/auth/instance', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  if (!isInstanceAdmin(session)) return c.json({ error: 'Forbidden' }, 403)
  if (!env.authDevMode) {
    return c.json({ error: 'enforce toggle only in AUTH_DEV_MODE' }, 403)
  }
  try {
    const body = (await c.req.json()) as { enforce?: boolean }
    if (typeof body.enforce === 'boolean') setAuthzEnforce(body.enforce)
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  return c.json({ enforce: isAuthzEnforce() })
})

app.post('/auth/instance/admins', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  let body: { sub?: string; iss?: string; email?: string }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  if (!body.sub || !body.iss) {
    return c.json({ error: 'sub and iss required' }, 400)
  }
  const result = addInstanceAdmin(session, { sub: body.sub, iss: body.iss })
  if (!result.ok) return c.json({ error: result.error }, 403)
  return c.json({ ok: true })
})

app.delete('/auth/instance/admins', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  let body: { sub?: string; iss?: string }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  if (!body.sub || !body.iss) {
    return c.json({ error: 'sub and iss required' }, 400)
  }
  const result = removeInstanceAdmin(session, { sub: body.sub, iss: body.iss })
  if (!result.ok) return c.json({ error: result.error }, 400)
  return c.json({ ok: true })
})

app.put('/auth/instance/permissions', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  let body: { sub?: string; iss?: string; permissions?: InstancePermission[] }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  if (!body.sub || !body.iss || !Array.isArray(body.permissions)) {
    return c.json({ error: 'sub, iss, permissions required' }, 400)
  }
  const result = setInstancePermissions(
    session,
    { sub: body.sub, iss: body.iss },
    body.permissions,
  )
  if (!result.ok) return c.json({ error: result.error }, 403)
  return c.json({ ok: true })
})

app.get('/auth/namespaces', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  return c.json({ namespaces: listNamespacesForUser(session) })
})

app.post('/auth/namespaces', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  if (
    !isInstanceAdmin(session) &&
    !hasInstancePermission(session, 'create_namespace')
  ) {
    return c.json({ error: 'Missing permission create_namespace' }, 403)
  }
  let body: {
    name?: string
    basePermission?: BasePermission
    membersCanCreateRepos?: boolean
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  if (!body.name || !body.basePermission) {
    return c.json({ error: 'name and basePermission required' }, 400)
  }
  const result = createNamespaceAuthz(
    session,
    body.name,
    body.basePermission,
    body.membersCanCreateRepos ?? true,
  )
  if (!result.ok) return c.json({ error: result.error }, 400)
  const name = body.name.trim()
  return c.json({
    ok: true,
    name,
    namespace: getNamespace(name),
  })
})

app.get('/auth/namespaces/:ns', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const ns = c.req.param('ns')
  preparePrincipal(session)
  const settings = getNamespace(ns)
  if (!settings) return c.json({ error: 'Not found' }, 404)
  if (!requireOwner(session, ns) && !resolveNamespaceRole(ns, session)) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  return c.json({
    name: ns,
    ...settings,
    members: listNamespaceMembers(ns),
  })
})

app.patch('/auth/namespaces/:ns', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const ns = c.req.param('ns')
  if (!requireNsCapability(session, ns, 'manage_settings')) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  let body: Partial<{
    basePermission: BasePermission
    membersCanCreateRepos: boolean
  }>
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  const result = updateNamespaceSettings(ns, body)
  if (!result.ok) return c.json({ error: result.error }, 400)
  return c.json({ ok: true, namespace: getNamespace(ns) })
})

/**
 * Delete namespace AuthZ (and optionally all oxen repositories under it).
 * Body: { deleteRepositories?: boolean } — default true.
 * Owners or instance admins only.
 */
app.delete('/auth/namespaces/:ns', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const ns = c.req.param('ns')
  preparePrincipal(session)
  if (!requireNsCapability(session, ns, 'delete_namespace')) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  if (!getNamespace(ns)) return c.json({ error: 'Not found' }, 404)

  let deleteRepositories = true
  try {
    const body = (await c.req.json()) as { deleteRepositories?: boolean }
    if (typeof body.deleteRepositories === 'boolean') {
      deleteRepositories = body.deleteRepositories
    }
  } catch {
    /* empty body → delete repositories by default */
  }

  const deletedRepos: string[] = []
  if (deleteRepositories) {
    try {
      const listRes = await fetch(
        `${env.oxenUpstream}/api/repos/${encodeURIComponent(ns)}`,
      )
      if (listRes.ok) {
        const listBody = (await listRes.json()) as {
          repositories?: Array<{ name?: string }>
        }
        const repos = listBody.repositories ?? []
        for (const r of repos) {
          const name = r.name
          if (!name) continue
          const delRes = await fetch(
            `${env.oxenUpstream}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`,
            { method: 'DELETE' },
          )
          if (!delRes.ok && delRes.status !== 404) {
            return c.json(
              {
                error: `Failed to delete repository ${ns}/${name} (${delRes.status})`,
              },
              502,
            )
          }
          deletedRepos.push(name)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'oxen error'
      return c.json({ error: `Failed to list/delete oxen repos: ${msg}` }, 502)
    }
  } else {
    try {
      const listRes = await fetch(
        `${env.oxenUpstream}/api/repos/${encodeURIComponent(ns)}`,
      )
      if (listRes.ok) {
        const listBody = (await listRes.json()) as {
          repositories?: unknown[]
        }
        if ((listBody.repositories ?? []).length > 0) {
          return c.json(
            {
              error:
                'Namespace still has repositories on oxen-server. Pass deleteRepositories: true or delete them first.',
            },
            409,
          )
        }
      }
    } catch {
      /* oxen unreachable — still allow AuthZ-only cleanup */
    }
  }

  const result = deleteNamespaceAuthz(ns)
  if (!result.ok) return c.json({ error: result.error }, 400)

  appendAudit({
    actor: actorFromUser(session),
    via: 'session',
    method: 'DELETE',
    path: `/auth/namespaces/${ns}`,
    status: 200,
    action: 'namespace.delete',
    namespace: ns,
    detail: { deletedRepos },
  })

  return c.json({ ok: true, deletedRepositories: deletedRepos })
})

app.put('/auth/namespaces/:ns/members', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const ns = c.req.param('ns')
  if (!requireNsCapability(session, ns, 'manage_members')) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  let body: {
    kind?: 'user' | 'group'
    sub?: string
    iss?: string
    group?: string
    role?: MemberRoleRef
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  if (!body.role) return c.json({ error: 'role required' }, 400)
  const kind = body.kind ?? (body.group && !body.sub ? 'group' : 'user')
  if (kind === 'group') {
    if (!body.group) return c.json({ error: 'group required' }, 400)
    const result = setNamespaceGroupMember(ns, body.group, body.role)
    if (!result.ok) return c.json({ error: result.error }, 400)
  } else {
    if (!body.sub || !body.iss) {
      return c.json({ error: 'sub, iss, role required' }, 400)
    }
    const result = setNamespaceMember(
      ns,
      { sub: body.sub, iss: body.iss },
      body.role,
    )
    if (!result.ok) return c.json({ error: result.error }, 400)
  }
  return c.json({ ok: true, members: listNamespaceMembers(ns) })
})

app.delete('/auth/namespaces/:ns/members', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const ns = c.req.param('ns')
  if (!requireNsCapability(session, ns, 'manage_members')) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  let body: {
    kind?: 'user' | 'group'
    sub?: string
    iss?: string
    group?: string
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  const kind = body.kind ?? (body.group && !body.sub ? 'group' : 'user')
  if (kind === 'group') {
    if (!body.group) return c.json({ error: 'group required' }, 400)
    const result = removeNamespaceGroupMember(ns, body.group)
    if (!result.ok) return c.json({ error: result.error }, 400)
  } else {
    if (!body.sub || !body.iss) {
      return c.json({ error: 'sub and iss required' }, 400)
    }
    const result = removeNamespaceMember(ns, { sub: body.sub, iss: body.iss })
    if (!result.ok) return c.json({ error: result.error }, 400)
  }
  return c.json({ ok: true, members: listNamespaceMembers(ns) })
})

app.get('/auth/namespaces/:ns/repos/:repo/collaborators', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const ns = c.req.param('ns')
  const repo = c.req.param('repo')
  preparePrincipal(session)
  if (!canManageRepoCollaborators(session, ns, repo)) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  return c.json({ collaborators: listRepoCollaborators(ns, repo) })
})

app.put('/auth/namespaces/:ns/repos/:repo/collaborators', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const ns = c.req.param('ns')
  const repo = c.req.param('repo')
  preparePrincipal(session)
  if (!canManageRepoCollaborators(session, ns, repo)) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  let body: {
    kind?: 'user' | 'group'
    sub?: string
    iss?: string
    group?: string
    role?: CollaboratorRoleRef
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  if (!body.role) return c.json({ error: 'role required' }, 400)
  const kind = body.kind ?? (body.group && !body.sub ? 'group' : 'user')
  if (kind === 'group') {
    if (!body.group) return c.json({ error: 'group required' }, 400)
    const result = setRepoGroupCollaborator(ns, repo, body.group, body.role)
    if (!result.ok) return c.json({ error: result.error }, 400)
  } else {
    if (!body.sub || !body.iss) {
      return c.json({ error: 'sub, iss, role required' }, 400)
    }
    const result = setRepoCollaborator(
      ns,
      repo,
      { sub: body.sub, iss: body.iss },
      body.role,
    )
    if (!result.ok) return c.json({ error: result.error }, 400)
  }
  return c.json({ ok: true, collaborators: listRepoCollaborators(ns, repo) })
})

app.delete('/auth/namespaces/:ns/repos/:repo/collaborators', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const ns = c.req.param('ns')
  const repo = c.req.param('repo')
  preparePrincipal(session)
  if (!canManageRepoCollaborators(session, ns, repo)) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  let body: {
    kind?: 'user' | 'group'
    sub?: string
    iss?: string
    group?: string
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  const kind = body.kind ?? (body.group && !body.sub ? 'group' : 'user')
  if (kind === 'group') {
    if (!body.group) return c.json({ error: 'group required' }, 400)
    removeRepoGroupCollaborator(ns, repo, body.group)
  } else {
    if (!body.sub || !body.iss) {
      return c.json({ error: 'sub and iss required' }, 400)
    }
    removeRepoCollaborator(ns, repo, { sub: body.sub, iss: body.iss })
  }
  return c.json({ ok: true, collaborators: listRepoCollaborators(ns, repo) })
})

app.get('/auth/namespaces/:ns/custom-roles/permissions', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const ns = c.req.param('ns')
  preparePrincipal(session)
  if (
    !requireNsCapability(session, ns, 'manage_custom_roles') &&
    !resolveNamespaceRole(ns, session)
  ) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  return c.json({
    namespaceCapabilities: ALL_NAMESPACE_CAPABILITIES,
    repoFinePermissions: ALL_REPO_FINE_PERMISSIONS,
    repoFineImpliedMin: REPO_FINE_IMPLIED_MIN,
  })
})

app.get('/auth/namespaces/:ns/custom-roles', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const ns = c.req.param('ns')
  preparePrincipal(session)
  if (!getNamespace(ns)) return c.json({ error: 'Not found' }, 404)
  if (
    !requireOwner(session, ns) &&
    !resolveNamespaceRole(ns, session) &&
    !isInstanceAdmin(session)
  ) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  return c.json({
    namespaceRoles: listCustomNamespaceRoles(ns),
    repoRoles: listCustomRepoRoles(ns),
  })
})

app.post('/auth/namespaces/:ns/custom-roles/namespace', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const ns = c.req.param('ns')
  if (!requireNsCapability(session, ns, 'manage_custom_roles')) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  if (!getNamespace(ns)) return c.json({ error: 'Not found' }, 404)
  let body: {
    name?: string
    description?: string
    permissions?: NamespaceCapability[]
    baseRepositoryRole?: BasePermission
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  if (!body.name || !body.permissions) {
    return c.json({ error: 'name and permissions required' }, 400)
  }
  const result = createCustomNamespaceRole(ns, {
    name: body.name,
    description: body.description,
    permissions: body.permissions,
    baseRepositoryRole: body.baseRepositoryRole,
  })
  if (!result.ok) return c.json({ error: result.error }, 400)
  return c.json({ ok: true, role: result.role })
})

app.patch('/auth/namespaces/:ns/custom-roles/namespace/:roleId', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const ns = c.req.param('ns')
  const roleId = c.req.param('roleId')
  if (!requireNsCapability(session, ns, 'manage_custom_roles')) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  let body: Partial<{
    name: string
    description: string | null
    permissions: NamespaceCapability[]
    baseRepositoryRole: BasePermission | null
  }>
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  const result = updateCustomNamespaceRole(ns, roleId, body)
  if (!result.ok) return c.json({ error: result.error }, 400)
  return c.json({ ok: true, role: result.role })
})

app.delete('/auth/namespaces/:ns/custom-roles/namespace/:roleId', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const ns = c.req.param('ns')
  const roleId = c.req.param('roleId')
  if (!requireNsCapability(session, ns, 'manage_custom_roles')) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const result = deleteCustomNamespaceRole(
    ns,
    roleId,
    isCustomNamespaceRoleAssigned(ns, roleId),
  )
  if (!result.ok) return c.json({ error: result.error }, 400)
  return c.json({ ok: true })
})

app.post('/auth/namespaces/:ns/custom-roles/repo', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const ns = c.req.param('ns')
  if (!requireNsCapability(session, ns, 'manage_custom_roles')) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  if (!getNamespace(ns)) return c.json({ error: 'Not found' }, 404)
  let body: {
    name?: string
    description?: string
    base?: 'read' | 'triage' | 'write' | 'maintain'
    permissions?: RepoFinePermission[]
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  if (!body.name || !body.base || !body.permissions) {
    return c.json({ error: 'name, base, and permissions required' }, 400)
  }
  const result = createCustomRepoRole(ns, {
    name: body.name,
    description: body.description,
    base: body.base,
    permissions: body.permissions,
  })
  if (!result.ok) return c.json({ error: result.error }, 400)
  return c.json({ ok: true, role: result.role })
})

app.patch('/auth/namespaces/:ns/custom-roles/repo/:roleId', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const ns = c.req.param('ns')
  const roleId = c.req.param('roleId')
  if (!requireNsCapability(session, ns, 'manage_custom_roles')) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  let body: Partial<{
    name: string
    description: string | null
    base: 'read' | 'triage' | 'write' | 'maintain'
    permissions: RepoFinePermission[]
  }>
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  const result = updateCustomRepoRole(ns, roleId, body)
  if (!result.ok) return c.json({ error: result.error }, 400)
  return c.json({ ok: true, role: result.role })
})

app.delete('/auth/namespaces/:ns/custom-roles/repo/:roleId', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const ns = c.req.param('ns')
  const roleId = c.req.param('roleId')
  if (!requireNsCapability(session, ns, 'manage_custom_roles')) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const result = deleteCustomRepoRole(
    ns,
    roleId,
    isCustomRepoRoleAssigned(ns, roleId),
  )
  if (!result.ok) return c.json({ error: result.error }, 400)
  return c.json({ ok: true })
})

app.all('/api/*', async (c) => {
  const authed = await requireAuth(c)
  if (!authed) {
    return c.json(
      {
        status: 'error',
        status_message: 'unauthorized',
        error: { detail: 'Authentication required' },
      },
      401,
    )
  }
  return proxyToOxen(c, { user: authed.user, via: authed.via })
})

console.log(
  `[boxen-auth] listening on :${env.port} → oxen ${env.oxenUpstream}` +
    ` (dev=${env.authDevMode} oidc=${oidcConfigured()})`,
)

serve({ fetch: app.fetch, port: env.port })
