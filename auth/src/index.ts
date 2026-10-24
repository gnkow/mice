import { serve } from '@hono/node-server'
import { Hono, type Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { assertProductionStartup } from './startupGate.js'
import { env, oidcConfigured } from './env.js'
import { sameOriginGuard } from './csrf.js'
import { sessionActivity } from './sessionActivity.js'
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
  auditEventsToCsv,
  auditFacets,
  queryAudit,
  queryAuditForExport,
  setAuditObserver,
  type AuditQuery,
  type AuditVia,
} from './audit.js'
import { auditActionLabel, knownAuditActions } from './auditLabels.js'
import {
  deriveOpsFromPathHistory,
  queryLineage,
  type LineageKind,
  type PathVersionHint,
} from './lineage.js'
import {
  canReviewAccessRequests,
  listAccessRequests,
  resolveAccessRequest,
  submitAccessRequest,
} from './accessRequests.js'
import {
  authorizeAuditQuery,
  authorizeCliDeviceApprove,
  authorizeLineageQuery,
  authorizeLineageRebuild,
  authorizeManageOwnTokens,
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
import {
  ALL_INSTANCE_PERMISSIONS,
  type BasePermission,
  type CollaboratorRoleRef,
  type InstancePermission,
  type MemberRoleRef,
  type NamespaceCapability,
  type RepoFinePermission,
} from './authzTypes.js'
import {
  approveDevice,
  denyDevice,
  lookupDeviceByUserCode,
  pollDevice,
  startDeviceAuth,
} from './cliDevice.js'
import {
  createPat,
  findPatByToken,
  listPatsForUser,
  resolvePat,
  revokePat,
  revokePatByToken,
} from './tokens.js'
import { registerJobRoutes } from './jobsRoutes.js'
import { startSessionLeaseRenewer } from './sessionsWorkspaces.js'
import { registerWorkspaceRoutes, startWorkspaceBackground } from './workspaces/routes.js'
import { registerMetaRoutes } from './metaRoutes.js'
import { registerFavoritesRoutes } from './favoritesRoutes.js'
import {
  AnnouncementError,
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
} from './announcementsStore.js'
import { purgeFavoritesForAudit } from './favoritesStore.js'
import { registerSessionRoutes } from './sessionsRoutes.js'
import {
  resumeInterruptedProvisions,
  startSessionsLifecycleSweeper,
} from './sessions.js'
import { attachSessionsGuacGateway } from './sessionsGateway.js'
import { resumeQueuedJobs } from './jobs.js'
import {
  captureNotificationAudit,
  rememberNotificationUser,
  registerNotificationRoutes,
  startNotificationWorker,
} from './notifications.js'

const PKCE_COOKIE = 'mice_oidc_pkce'
/** After Mice logout, next /auth/login must show IdP credentials (no silent SSO). */
const PROMPT_LOGIN_COOKIE = 'mice_prompt_login'

type PkceState = {
  verifier: string
  state: string
  nonce: string
  /** Optional relative path to return to after OIDC (e.g. /cli/device?user_code=…). */
  next?: string
}

function safeReturnPath(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined
  if (!raw.startsWith('/') || raw.startsWith('//')) return undefined
  if (raw.startsWith('/login') || raw.startsWith('/auth/')) return undefined
  return raw
}

assertProductionStartup()

const app = new Hono()
app.use('*', sameOriginGuard)
app.use('*', sessionActivity)
setAuditObserver((event) => {
  try { purgeFavoritesForAudit(event) } catch (err) { console.error('[mice-auth] favorites purge failed', err) }
  captureNotificationAudit(event)
})

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
    loginExample: 'mice login',
    cloneExample: `mice clone ${remote}/<namespace>/<repo>`,
    /** Automation / CI still use a manually minted PAT. */
    configExample: `oxen config --auth ${authHost} <PAT>`,
    oxenCloneExample: `oxen clone ${remote}/<namespace>/<repo>`,
  })
})

// --- CLI device login (Mice-native pairing; no IdP device grant required) ---

app.post('/auth/cli/device/start', (c) => {
  const started = startDeviceAuth()
  return c.json(started)
})

/** Redirect browser to the web UI approve page. */
app.get('/auth/cli/device', (c) => {
  const userCode = c.req.query('user_code') ?? ''
  const target = new URL(`${env.publicWebOrigin}/cli/device`)
  if (userCode) target.searchParams.set('user_code', userCode)
  return c.redirect(target.toString())
})

app.get('/auth/cli/device/status', async (c) => {
  const session = await requireBrowserSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  const userCode = c.req.query('user_code') ?? ''
  if (!userCode.trim()) return c.json({ error: 'user_code required' }, 400)
  const lookup = lookupDeviceByUserCode(userCode)
  if (!lookup) return c.json({ error: 'Unknown user code' }, 404)
  return c.json(lookup)
})

app.post('/auth/cli/device/approve', async (c) => {
  const session = await requireBrowserSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  const gate = authorizeCliDeviceApprove(session)
  if (!gate.allow) {
    return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
  }
  let userCode = ''
  try {
    const body = (await c.req.json()) as { user_code?: string }
    userCode = body.user_code ?? ''
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  if (!userCode.trim()) return c.json({ error: 'user_code required' }, 400)
  const result = approveDevice(userCode, session)
  if (!result.ok) {
    const status = result.status === 404 ? 404 : 400
    return c.json({ error: result.error }, status)
  }
  auditMutation(c, session, 'session', {
    action: 'device.approve',
    message: `Approved device login: ${result.userCode}`,
    detail: { userCode: result.userCode },
  })
  return c.json({ ok: true, user_code: result.userCode })
})

app.post('/auth/cli/device/deny', async (c) => {
  const session = await requireBrowserSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  const gate = authorizeCliDeviceApprove(session)
  if (!gate.allow) {
    return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
  }
  let userCode = ''
  try {
    const body = (await c.req.json()) as { user_code?: string }
    userCode = body.user_code ?? ''
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  if (!userCode.trim()) return c.json({ error: 'user_code required' }, 400)
  const result = denyDevice(userCode)
  if (!result.ok) {
    const status = result.status === 404 ? 404 : 400
    return c.json({ error: result.error }, status)
  }
  auditMutation(c, session, 'session', {
    action: 'device.deny',
    message: `Denied device login: ${userCode.trim().toUpperCase()}`,
    detail: { userCode: userCode.trim().toUpperCase() },
  })
  return c.json({ ok: true })
})

app.post('/auth/cli/device/poll', async (c) => {
  let deviceCode = ''
  try {
    const body = (await c.req.json()) as { device_code?: string }
    deviceCode = body.device_code ?? ''
  } catch {
    return c.json({ error: 'Invalid body' }, 400)
  }
  if (!deviceCode.trim()) return c.json({ error: 'device_code required' }, 400)
  const result = pollDevice(deviceCode)
  if (result.status === 'authorization_pending') {
    return c.json({ status: 'authorization_pending' }, 400)
  }
  if (result.status === 'slow_down') {
    return c.json(
      { status: 'slow_down', interval: result.interval },
      400,
    )
  }
  if (result.status === 'expired_token') {
    return c.json({ status: 'expired_token', error: 'expired_token' }, 400)
  }
  if (result.status === 'access_denied') {
    return c.json({ status: 'access_denied', error: 'access_denied' }, 400)
  }
  if (result.status === 'error') {
    return c.json({ status: 'error', error: result.error }, 400)
  }
  auditMutation(c, result.user, 'pat', {
    action: 'device.redeem',
    message: 'CLI device login completed; token issued',
    detail: { patId: result.patId },
  })
  return c.json({
    status: 'approved',
    access_token: result.token,
    token: result.token,
    pat_id: result.patId,
    remote: result.remote,
    auth_host: result.authHost,
    user: result.user,
  })
})

app.post('/auth/cli/logout', async (c) => {
  const auth = c.req.header('authorization') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  if (!bearer) return c.json({ error: 'Bearer token required' }, 401)
  const user = resolvePat(bearer)
  const ok = revokePatByToken(bearer)
  if (!ok) return c.json({ error: 'Token not found' }, 404)
  if (user) {
    auditMutation(c, user, 'pat', {
      action: 'token.revoke',
      message: 'Revoked token via CLI logout',
    })
  }
  return c.json({ ok: true })
})

app.get('/auth/cli/whoami', async (c) => {
  const auth = c.req.header('authorization') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  if (!bearer) return c.json({ error: 'Bearer token required' }, 401)
  const user = resolvePat(bearer)
  if (!user) return c.json({ error: 'Invalid token' }, 401)
  preparePrincipal(user)
  const pat = findPatByToken(bearer)
  const pending = isPendingUser(user)
  return c.json({
    authenticated: true,
    user: {
      sub: user.sub,
      iss: user.iss,
      email: user.email,
      name: user.name,
    },
    pat: pat
      ? { id: pat.id, label: pat.label, source: pat.source ?? 'manual' }
      : null,
    authz: {
      enforce: isAuthzEnforce(),
      pending,
      instanceAdmin: isInstanceAdmin(user),
      hasAnyGrant: userHasAnyGrant(user),
    },
    remote: env.publicOxenRemote,
  })
})

app.get('/auth/me', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ authenticated: false }, 401)
  preparePrincipal(session)
  rememberNotificationUser(session)
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
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  const pending = isPendingUser(session)
  return c.json({
    enforce: isAuthzEnforce(),
    pending,
    instanceAdmin: isInstanceAdmin(session),
    permissions: Object.fromEntries(
      ALL_INSTANCE_PERMISSIONS.map((p) => [
        p,
        hasInstancePermission(session, p),
      ]),
    ) as Record<(typeof ALL_INSTANCE_PERMISSIONS)[number], boolean>,
    instancePermissionCatalog: ALL_INSTANCE_PERMISSIONS,
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
  auditMutation(c, session, 'session', {
    action: 'access-request.submit',
    message: 'Submitted access request',
    detail: { requestId: req.id },
  })
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
  if (!result.ok) {
    auditMutation(c, session, 'session', {
      action: `access-request.${body.action}`,
      status: 400,
      message: `Access request ${body.action} failed: ${result.error}`,
      detail: { requestId: c.req.param('id') },
    })
    return c.json({ error: result.error }, 400)
  }
  auditMutation(c, session, 'session', {
    action: `access-request.${body.action}`,
    namespace: body.action === 'approve' ? body.namespace : undefined,
    message: `Access request ${result.request.status}`,
    detail: {
      requestId: result.request.id,
      requester: { sub: result.request.sub, iss: result.request.iss },
      ...(body.action === 'approve'
        ? { role: body.role, permission: body.permission }
        : {}),
    },
  })
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
    if (!result.ok) {
      auditMutation(c, session, 'session', {
        action: 'training.update',
        status: 403,
        message: `Training update denied: ${result.error}`,
        detail: { target, completed: done },
      })
      return c.json({ error: result.error }, 403)
    }
  }
  auditMutation(c, session, 'session', {
    action: 'training.update',
    message: `Set training completed=${done} for ${self ? 'self' : target.sub}`,
    detail: { target, completed: done, self },
  })
  return c.json({
    ok: true,
    trainingCompleted: hasCompletedTraining(target),
  })
})

type AuditFields = {
  action: string
  message?: string
  namespace?: string
  repo?: string
  detail?: Record<string, unknown>
  status?: number
}

/** Append an audit event for a BFF-native (non-proxied) mutation. Never pass secrets in `detail`. */
function auditMutation(
  c: Parameters<typeof proxyToOxen>[0],
  user: Pick<SessionUser, 'sub' | 'iss' | 'email' | 'name'>,
  via: AuditVia,
  fields: AuditFields,
): void {
  appendAudit({
    actor: actorFromUser(user as SessionUser),
    via: callerVia(c, via),
    method: c.req.method,
    path: c.req.path,
    status: fields.status ?? 200,
    action: fields.action,
    ...(fields.message ? { message: fields.message } : {}),
    ...(fields.namespace ? { namespace: fields.namespace } : {}),
    ...(fields.repo ? { repo: fields.repo } : {}),
    ...(fields.detail ? { detail: fields.detail } : {}),
  })
}

function memberTarget(body: {
  kind?: 'user' | 'group'
  sub?: string
  iss?: string
  group?: string
}): Record<string, unknown> {
  const kind = body.kind ?? (body.group && !body.sub ? 'group' : 'user')
  return kind === 'group'
    ? { kind, group: body.group }
    : { kind, sub: body.sub, iss: body.iss }
}

/** Browser cookie session only (token minting, device approval). */
async function requireBrowserSession(c: Parameters<typeof getSession>[0]) {
  const session = await getSession(c)
  if (!session) return null
  rememberNotificationUser(session)
  return session
}

/**
 * Cookie session, or an unscoped CLI PAT acting as its owner. Scoped PATs are
 * rejected: AuthZ admin/audit routes are not expressible in repo-scoped grants.
 */
async function requireSession(c: Context) {
  const session = await requireBrowserSession(c)
  if (session) return session
  const auth = c.req.header('authorization') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  if (!bearer) return null
  const pat = resolvePat(bearer)
  if (!pat || pat.patScopes?.length) return null
  c.set('authVia' as never, 'pat' as never)
  rememberNotificationUser(pat)
  return pat
}

function callerVia(c: Context, fallback: AuditVia): AuditVia {
  return c.get('authVia' as never) === 'pat' ? 'pat' : fallback
}

app.get('/auth/tokens', async (c) => {
  const session = await requireBrowserSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  const gate = authorizeManageOwnTokens(session)
  if (!gate.allow) {
    return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
  }
  return c.json({ tokens: listPatsForUser(session) })
})

app.post('/auth/tokens', async (c) => {
  const session = await requireBrowserSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  const gate = authorizeManageOwnTokens(session)
  if (!gate.allow) {
    return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
  }
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
  auditMutation(c, session, 'session', {
    action: 'token.create',
    message: `Created token: ${label}`,
    detail: { tokenId: pat.id, label, scopes },
  })
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
  const session = await requireBrowserSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  const gate = authorizeManageOwnTokens(session)
  if (!gate.allow) {
    return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
  }
  const id = c.req.param('id')
  const ok = revokePat(session, id)
  if (!ok) return c.json({ error: 'Token not found' }, 404)
  auditMutation(c, session, 'session', {
    action: 'token.revoke',
    message: `Revoked token: ${id}`,
    detail: { tokenId: id },
  })
  return c.json({ ok: true })
})

/** Resolve the caller's audit scope + filters; returns a Response on failure. */
async function resolveAuditQuery(
  c: Context,
): Promise<
  | { error: Response }
  | { session: SessionUser; query: AuditQuery }
> {
  const session = await requireSession(c)
  if (!session) {
    return { error: c.json({ error: 'Authentication required' }, 401) }
  }
  preparePrincipal(session)
  let namespace = c.req.query('namespace') || undefined
  const gate = authorizeAuditQuery(session, namespace)
  if (!gate.allow) {
    return { error: c.json({ error: gate.reason ?? 'Forbidden' }, 403) }
  }
  if (gate.forceNamespace) namespace = gate.forceNamespace
  const via = c.req.query('via')
  return {
    session,
    query: {
      actor: c.req.query('actor') || undefined,
      namespace,
      repo: c.req.query('repo') || undefined,
      action: c.req.query('action') || undefined,
      since: c.req.query('since') || undefined,
      until: c.req.query('until') || undefined,
      sessionId: c.req.query('session_id') || undefined,
      workspaceId: c.req.query('workspace_id') || undefined,
      jobId: c.req.query('job_id') || undefined,
      via: via === 'session' || via === 'pat' ? via : undefined,
      allowedNamespaces: gate.ownedOnly,
    },
  }
}

/** Query append-only audit log (session required). */
app.get('/auth/audit', async (c) => {
  const r = await resolveAuditQuery(c)
  if ('error' in r) return r.error
  const limitRaw = c.req.query('limit')
  const limit = limitRaw ? Number(limitRaw) : undefined
  const { events, nextCursor } = queryAudit({
    ...r.query,
    cursor: c.req.query('cursor') || undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  })
  return c.json({
    events: events.map((e) => ({ ...e, action_label: auditActionLabel(e.action) })),
    nextCursor,
  })
})

/** Filter dropdown options: known actions plus sessions/workspaces/jobs seen in the log. */
app.get('/auth/audit/facets', async (c) => {
  const r = await resolveAuditQuery(c)
  if ('error' in r) return r.error
  const f = auditFacets({
    namespace: r.query.namespace,
    allowedNamespaces: r.query.allowedNamespaces,
  })
  return c.json({
    actions: knownAuditActions(),
    sessions: f.sessions,
    workspaces: f.workspaces,
    jobs: f.jobs,
  })
})

/** CSV export honouring the same filters and scope as the list. */
app.get('/auth/audit/export.csv', async (c) => {
  const r = await resolveAuditQuery(c)
  if ('error' in r) return r.error
  const { events, truncated } = queryAuditForExport(r.query)
  const csv = auditEventsToCsv(events)
  appendAudit({
    actor: actorFromUser(r.session),
    via: callerVia(c, 'session'),
    action: 'audit.export',
    method: c.req.method,
    path: c.req.path,
    status: 200,
    message: `Exported ${events.length} audit events to CSV`,
    detail: { rows: events.length, truncated, filters: { ...r.query, allowedNamespaces: undefined } },
  })
  const day = new Date().toISOString().slice(0, 10)
  c.header('Content-Type', 'text/csv; charset=utf-8')
  c.header('Content-Disposition', `attachment; filename="audit-${day}.csv"`)
  c.header('Cache-Control', 'no-store')
  if (truncated) c.header('X-Audit-Truncated', 'true')
  return c.body(csv)
})

/** Query file lineage graph for a repo (session required; repo read). */
app.get('/auth/lineage', async (c) => {
  const session = await requireSession(c)
  if (!session) {
    return c.json({ error: 'Authentication required' }, 401)
  }

  preparePrincipal(session)
  const namespace = c.req.query('namespace') || undefined
  const repo = c.req.query('repo') || undefined
  const gate = authorizeLineageQuery(session, namespace, repo)
  if (!gate.allow) {
    return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
  }
  if (!namespace || !repo) {
    return c.json({ error: 'namespace and repo are required' }, 400)
  }

  const limitRaw = c.req.query('limit')
  const limit = limitRaw ? Number(limitRaw) : undefined
  const depthRaw = c.req.query('depth')
  const depth = depthRaw ? Number(depthRaw) : undefined
  const directionRaw = c.req.query('direction')
  const direction =
    directionRaw === 'ancestors' ||
    directionRaw === 'descendants' ||
    directionRaw === 'both'
      ? directionRaw
      : undefined
  const kindRaw = c.req.query('kind')
  const kind = kindRaw as LineageKind | undefined

  const { operations, nextCursor } = queryLineage({
    namespace,
    repo,
    path: c.req.query('path') || undefined,
    contentHash: c.req.query('contentHash') || undefined,
    direction,
    depth: Number.isFinite(depth) ? depth : undefined,
    since: c.req.query('since') || undefined,
    until: c.req.query('until') || undefined,
    cursor: c.req.query('cursor') || undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
    kind,
    jobId: c.req.query('jobId') || undefined,
    commit: c.req.query('commit') || undefined,
  })
  return c.json({ operations, nextCursor })
})

/**
 * Rebuild derived lineage for a path from oxen path-version history.
 * Body: { namespace, repo, branch?, path }
 */
app.post('/auth/lineage/rebuild', async (c) => {
  const session = await requireSession(c)
  if (!session) {
    return c.json({ error: 'Authentication required' }, 401)
  }

  preparePrincipal(session)
  let body: {
    namespace?: string
    repo?: string
    branch?: string
    path?: string
  }
  try {
    body = (await c.req.json()) as typeof body
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }
  const namespace = body.namespace?.trim()
  const repo = body.repo?.trim()
  const path = body.path?.trim()
  const branch = (body.branch?.trim() || 'main')
  if (!namespace || !repo || !path) {
    return c.json({ error: 'namespace, repo, and path are required' }, 400)
  }

  const gate = authorizeLineageRebuild(session, namespace, repo)
  if (!gate.allow) {
    return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
  }

  const resource = path
    .split('/')
    .filter(Boolean)
    .map((p) => encodeURIComponent(p))
    .join('/')
  const repoApi = `${env.oxenUpstream}/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}`
  const looksLikeCommitId = /^[0-9a-f]{16,64}$/i.test(branch)
  const branchVersionsUrl = `${repoApi}/branches/${encodeURIComponent(branch)}/versions/${resource}?page=1&page_size=100`
  const historyUrl = `${repoApi}/commits/history/${[branch, ...path.split('/').filter(Boolean)].map(encodeURIComponent).join('/')}?page=1&page_size=100`

  type VersionRow = {
    commit?: { id?: string; timestamp?: string }
    resource?: { path?: string; version?: string }
  }
  type HistoryRow = {
    id?: string
    timestamp?: string
  }

  async function fetchJson(url: string): Promise<{ ok: boolean; status: number; json: unknown }> {
    try {
      const upstream = await fetch(url)
      let json: unknown = null
      try {
        json = await upstream.json()
      } catch {
        json = null
      }
      return { ok: upstream.ok, status: upstream.status, json }
    } catch (err) {
      console.error('[mice-auth] lineage rebuild fetch failed', err)
      return { ok: false, status: 502, json: null }
    }
  }

  let hints: PathVersionHint[] = []
  if (!looksLikeCommitId) {
    const branchRes = await fetchJson(branchVersionsUrl)
    if (branchRes.ok && branchRes.json && typeof branchRes.json === 'object') {
      const rows =
        (branchRes.json as { versions?: VersionRow[] }).versions ?? []
      // API returns newest-first typically; normalize to oldest-first.
      hints = rows
        .map((v) => ({
          path: v.resource?.path || path,
          contentHash: v.resource?.version,
          commitId: v.commit?.id,
          ts: v.commit?.timestamp,
        }))
        .reverse()
    } else if (branchRes.status !== 404 && branchRes.status !== 400) {
      return c.json(
        { error: `oxen versions failed (${branchRes.status})` },
        502,
      )
    }
  }

  if (hints.length === 0) {
    const histRes = await fetchJson(historyUrl)
    if (!histRes.ok) {
      return c.json(
        { error: `oxen versions failed (${histRes.status})` },
        502,
      )
    }
    if (!histRes.json || typeof histRes.json !== 'object') {
      return c.json({ error: 'Invalid oxen versions response' }, 502)
    }
    const commits =
      (histRes.json as { commits?: HistoryRow[] }).commits ?? []
    hints = commits
      .map((commit) => ({
        path,
        commitId: commit.id,
        ts: commit.timestamp,
      }))
      .reverse()
  }

  const created = deriveOpsFromPathHistory(namespace, repo, branch, hints)
  auditMutation(c, session, 'session', {
    action: 'lineage.rebuild',
    namespace,
    repo,
    message: `Rebuilt lineage for ${path}`,
    detail: { branch, path, created: created.length },
  })
  return c.json({
    created: created.length,
    operations: created,
    // Re-running rebuild is a no-op once each version has a single producer.
    idempotent: created.length === 0,
  })
})

app.get('/auth/login', async (c) => {
  if (!oidcConfigured()) {
    return c.json({ error: 'OIDC is not configured' }, 503)
  }
  await loadOidcConfig()
  const verifier = randomString(32)
  const state = randomString(16)
  const nonce = randomString(16)
  const challenge = await pkceChallenge(verifier)
  const next = safeReturnPath(c.req.query('next'))
  const pkce: PkceState = {
    verifier,
    state,
    nonce,
    ...(next ? { next } : {}),
  }
  setCookie(c, PKCE_COOKIE, Buffer.from(JSON.stringify(pkce)).toString('base64url'), {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: 600,
  })
  // Always prompt=login so Sign in with SSO shows the IdP credential form
  // (covers Keycloak SSO cookies that survived Mice-only logout).
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
      nonce: pkce.nonce,
    })
    const sessionUser: SessionUser = {
      sub: user.sub,
      iss: user.iss,
      email: user.email,
      name: user.name,
      idToken: user.idToken,
      ...(user.authTime !== undefined ? { authTime: user.authTime } : {}),
      ...(user.groups.length ? { groups: user.groups } : {}),
    }
    preparePrincipal(sessionUser)
    rememberNotificationUser(sessionUser)
    await setSessionCookie(c, sessionUser)
    auditMutation(c, sessionUser, 'session', {
      action: 'auth.login',
      message: 'Signed in via SSO',
    })
    const dest = safeReturnPath(pkce.next) ?? '/'
    return c.redirect(dest)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'login failed'
    return c.html(`<p>${msg}</p><p><a href="/auth/login">Retry</a></p>`, 500)
  }
})

async function finishLogout(c: Parameters<typeof getSession>[0]) {
  const session = await getSession(c)
  if (session) {
    auditMutation(c, session, 'session', {
      action: 'auth.logout',
      message: 'Signed out',
    })
  }
  clearSessionCookie(c)
  setCookie(c, PROMPT_LOGIN_COOKIE, '1', {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: 600,
  })

  // RP-initiated IdP logout when we have an OIDC id_token.
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
  })
})

app.patch('/auth/instance', async (c) => {
  const session = await requireSession(c)
  if (!session) return c.json({ error: 'Authentication required' }, 401)
  preparePrincipal(session)
  if (!isInstanceAdmin(session)) return c.json({ error: 'Forbidden' }, 403)
  try {
    const body = (await c.req.json()) as { enforce?: boolean }
    if (typeof body.enforce === 'boolean') {
      const oldValue = isAuthzEnforce()
      setAuthzEnforce(body.enforce)
      auditMutation(c, session, 'session', {
        action: 'instance.settings.update',
        message: `Updated instance enforce: ${oldValue} → ${body.enforce}`,
        detail: { enforce: body.enforce, previousEnforce: oldValue },
      })
    }
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
  if (!result.ok) {
    auditMutation(c, session, 'session', {
      action: 'instance.admin.add',
      status: 403,
      message: `Add instance admin denied: ${result.error}`,
      detail: { target: { sub: body.sub, iss: body.iss } },
    })
    return c.json({ error: result.error }, 403)
  }
  auditMutation(c, session, 'session', {
    action: 'instance.admin.add',
    message: `Added instance admin ${body.sub}`,
    detail: { target: { sub: body.sub, iss: body.iss } },
  })
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
  if (!result.ok) {
    auditMutation(c, session, 'session', {
      action: 'instance.admin.remove',
      status: 400,
      message: `Remove instance admin failed: ${result.error}`,
      detail: { target: { sub: body.sub, iss: body.iss } },
    })
    return c.json({ error: result.error }, 400)
  }
  auditMutation(c, session, 'session', {
    action: 'instance.admin.remove',
    message: `Removed instance admin ${body.sub}`,
    detail: { target: { sub: body.sub, iss: body.iss } },
  })
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
  if (!result.ok) {
    auditMutation(c, session, 'session', {
      action: 'instance.permissions.update',
      status: 403,
      message: `Instance permissions update denied: ${result.error}`,
      detail: { target: { sub: body.sub, iss: body.iss } },
    })
    return c.json({ error: result.error }, 403)
  }
  auditMutation(c, session, 'session', {
    action: 'instance.permissions.update',
    message: `Set instance permissions for ${body.sub}`,
    detail: {
      target: { sub: body.sub, iss: body.iss },
      permissions: body.permissions,
    },
  })
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
  auditMutation(c, session, 'session', {
    action: 'namespace.create',
    namespace: name,
    message: `Created namespace ${name}`,
    detail: {
      basePermission: body.basePermission,
      membersCanCreateRepos: body.membersCanCreateRepos ?? true,
    },
  })
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
  const previous = getNamespace(ns)
  const result = updateNamespaceSettings(ns, body)
  if (!result.ok) return c.json({ error: result.error }, 400)
  auditMutation(c, session, 'session', {
    action: 'namespace.settings.update',
    namespace: ns,
    message: `Updated settings for namespace ${ns}`,
    detail: {
      previous: previous && {
        basePermission: previous.basePermission,
        membersCanCreateRepos: previous.membersCanCreateRepos,
      },
      next: {
        basePermission: body.basePermission,
        membersCanCreateRepos: body.membersCanCreateRepos,
      },
    },
  })
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
          auditMutation(c, session, 'session', {
            action: 'repo.delete',
            namespace: ns,
            repo: name,
            message: `Deleted repository ${ns}/${name} (namespace deletion)`,
            detail: { cascade: 'namespace.delete' },
          })
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

  auditMutation(c, session, 'session', {
    action: 'namespace.delete',
    namespace: ns,
    message: `Deleted namespace ${ns}`,
    detail: { deletedRepos, deleteRepositories },
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
  auditMutation(c, session, 'session', {
    action: 'namespace.member.set',
    namespace: ns,
    message: `Set namespace member role ${body.role}`,
    detail: { target: memberTarget(body), role: body.role },
  })
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
  auditMutation(c, session, 'session', {
    action: 'namespace.member.remove',
    namespace: ns,
    message: 'Removed namespace member',
    detail: { target: memberTarget(body) },
  })
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
  auditMutation(c, session, 'session', {
    action: 'repo.collaborator.set',
    namespace: ns,
    repo,
    message: `Set repository collaborator role ${body.role}`,
    detail: { target: memberTarget(body), role: body.role },
  })
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
  auditMutation(c, session, 'session', {
    action: 'repo.collaborator.remove',
    namespace: ns,
    repo,
    message: 'Removed repository collaborator',
    detail: { target: memberTarget(body) },
  })
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
  auditMutation(c, session, 'session', {
    action: 'custom-role.namespace.create',
    namespace: ns,
    message: `Created namespace role ${body.name}`,
    detail: {
      roleId: result.role.id,
      permissions: body.permissions,
      baseRepositoryRole: body.baseRepositoryRole,
    },
  })
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
  auditMutation(c, session, 'session', {
    action: 'custom-role.namespace.update',
    namespace: ns,
    message: `Updated namespace role ${roleId}`,
    detail: { roleId, changes: body },
  })
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
  auditMutation(c, session, 'session', {
    action: 'custom-role.namespace.delete',
    namespace: ns,
    message: `Deleted namespace role ${roleId}`,
    detail: { roleId },
  })
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
  auditMutation(c, session, 'session', {
    action: 'custom-role.repo.create',
    namespace: ns,
    message: `Created repository role ${body.name}`,
    detail: {
      roleId: result.role.id,
      base: body.base,
      permissions: body.permissions,
    },
  })
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
  auditMutation(c, session, 'session', {
    action: 'custom-role.repo.update',
    namespace: ns,
    message: `Updated repository role ${roleId}`,
    detail: { roleId, changes: body },
  })
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
  auditMutation(c, session, 'session', {
    action: 'custom-role.repo.delete',
    namespace: ns,
    message: `Deleted repository role ${roleId}`,
    detail: { roleId },
  })
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

registerJobRoutes(app)
registerWorkspaceRoutes(app)
registerMetaRoutes(app)
registerFavoritesRoutes(app)

// --- Instance announcements: any signed-in user reads live ones; instance admins manage ---

async function announcementPrincipal(c: Context, admin: boolean) {
  const session = await requireSession(c)
  if (!session) return { error: c.json({ error: 'Authentication required' }, 401) } as const
  preparePrincipal(session)
  if (admin && !isInstanceAdmin(session)) return { error: c.json({ error: 'Forbidden' }, 403) } as const
  return { session } as const
}

function announcementFail(c: Context, err: unknown) {
  if (err instanceof AnnouncementError) return c.json({ error: err.message }, err.status)
  throw err
}

app.get('/auth/announcements', async (c) => {
  const wantAll = c.req.query('all') === '1'
  const p = await announcementPrincipal(c, wantAll)
  if ('error' in p) return p.error
  return c.json({ announcements: listAnnouncements({ all: wantAll }) })
})

app.post('/auth/announcements', async (c) => {
  const p = await announcementPrincipal(c, true)
  if ('error' in p) return p.error
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const row = createAnnouncement(body, `${p.session.name || p.session.email || p.session.sub}`)
    auditMutation(c, p.session, 'session', {
      action: 'announcement.create',
      message: `Published announcement "${row.title}"`,
      detail: { announcementId: row.id, severity: row.severity },
    })
    return c.json({ announcement: row }, 201)
  } catch (err) {
    return announcementFail(c, err)
  }
})

app.patch('/auth/announcements/:id', async (c) => {
  const p = await announcementPrincipal(c, true)
  if ('error' in p) return p.error
  try {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const row = updateAnnouncement(c.req.param('id'), body)
    auditMutation(c, p.session, 'session', {
      action: 'announcement.update',
      message: `Updated announcement "${row.title}"`,
      detail: { announcementId: row.id, active: row.active },
    })
    return c.json({ announcement: row })
  } catch (err) {
    return announcementFail(c, err)
  }
})

app.delete('/auth/announcements/:id', async (c) => {
  const p = await announcementPrincipal(c, true)
  if ('error' in p) return p.error
  try {
    const row = deleteAnnouncement(c.req.param('id'))
    auditMutation(c, p.session, 'session', {
      action: 'announcement.delete',
      message: `Deleted announcement "${row.title}"`,
      detail: { announcementId: row.id },
    })
    return c.json({ ok: true })
  } catch (err) {
    return announcementFail(c, err)
  }
})
registerSessionRoutes(app)
registerNotificationRoutes(app)
startNotificationWorker()
resumeQueuedJobs()
void startWorkspaceBackground()
startSessionsLifecycleSweeper()
startSessionLeaseRenewer()
resumeInterruptedProvisions()

console.log(
  `[mice-auth] listening on :${env.port} → oxen ${env.oxenUpstream}` +
    ` (oidc=${oidcConfigured()}; jobs=${env.jobsRunner}; sessions=${env.sessionsEnabled})`,
)

const server = serve({ fetch: app.fetch, port: env.port })
attachSessionsGuacGateway(server as never)
