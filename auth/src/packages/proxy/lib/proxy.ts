import type { Context } from 'hono'
import { env } from '../../shared/index.js'
import { EMPTY_AUDIT_CHANGE, NoChangeError, requireAuditChange } from '../../audit/change.js'
import type { AuditChange } from '../../audit/change.js'
import { proxyMutationChange, workspaceFilePathsFromPathname, workspaceIdFromAnswer } from './proxyChange.js'
import { interpretRequest } from '../../authentication/session.js'
import type { SessionUser } from '../../authentication/principal.js'
import { actorFromUser } from '../../audit/index.js'
import { appendIntent, appendOutcome } from '../../audit/index.js'
import { auditChainBlocked } from '../../audit/index.js'
import type { AuditEvent, AuditVia } from '../../audit/index.js'
import { auditUnavailableResponse } from '../../audit/index.js'
import { AuditDetailPolicyError } from '../../audit/index.js'
import { isDatasetMutation } from '../../audit/index.js'
import { intentReasonFields } from '../../audit/index.js'
import { mutationSignatureAuditDetail } from '../../authentication/signing.js'
import { createDatasetCapture, createLineageCapture, type DatasetVersions } from './proxyLineage.js'
import { authorizeApiRequest } from '../../authz/index.js'
import { interpretRequestBody } from './proxyBody.js'
import { nonCanonicalPathReason } from '../../shared/index.js'
import {
  ensureBranchCreateSourceTip,
  filterNamespaceCatalog,
  finalizeProxiedRepoCreate,
  markStaleAfterProxiedTipWrite,
  recordAclBypassRead,
  stampRepositoryIdOnRepoDetail,
} from './proxyEffects.js'
import {
  mapDisplayRequestToPhysical,
  mapPhysicalResponseToDisplay,
  type PhysicalRepoRef,
} from '../../namespaces/index.js'
import { renameRepository } from '../../authz/index.js'
import { decideSelfMerge, selfMergeAuditDetail } from '../../merge/index.js'
import { branchTargetFromPath, decideValidatedBranchWrite } from '../../merge/index.js'
import { filterRequestHeaders, HOP_BY_HOP } from './proxyHeaders.js'
import {
  auditChainBroken,
  changeUnavailableResponse,
  noChangeResponse,
  rejectUnclassifiedWrite,
  rejectUnsupportedOperation,
} from './proxyReject.js'
import { resolveMutationControls } from './proxyMutationControls.js'
import { getUpstreamFetch, loadMergeAuthors, setUpstreamFetch } from './proxyUpstream.js'

export { setUpstreamFetch }


export type ProxyAuth = {
  user: SessionUser
  via: AuditVia
}

export async function proxyToOxen(
  c: Context,
  auth: ProxyAuth,
): Promise<Response> {
  const { user, via } = auth
  const url = new URL(c.req.url)
  const pathname = url.pathname
  const method = c.req.method
  const nonCanonical = nonCanonicalPathReason(pathname)
  if (nonCanonical) {
    return new Response(
      JSON.stringify({
        status: 'error',
        status_message: 'bad_request',
        error: { detail: `Non-canonical request path (${nonCanonical})` },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )
  }

  const mutatingEarly = method !== 'GET' && method !== 'HEAD'
  const classifiedEarly = interpretRequest(method, pathname)
  // Unknown mutating routes are refused — never audited as a catch-all "other" operation.
  if (mutatingEarly && !classifiedEarly.recognized) {
    return rejectUnsupportedOperation(user, via, method, pathname, {
      namespace: classifiedEarly.namespace,
      repo: classifiedEarly.repo,
    })
  }

  const reqHeaders = filterRequestHeaders(c.req.raw.headers)

  const {
    body,
    signatureBody,
    message,
    createNs,
    createRepo,
    bodyWorkspaceId,
    moveNewPath,
    copyFrom,
    restoreFrom,
    rejection,
  } = await interpretRequestBody(c, user, method, pathname, url.searchParams, reqHeaders)

  const decision = await authorizeApiRequest({
    user,
    via,
    method,
    pathname,
    createNamespace: createNs,
    createRepo: createRepo,
  })
  if (!decision.allow) {
    return new Response(
      JSON.stringify({
        status: 'error',
        status_message: decision.status === 503 ? 'unavailable' : 'forbidden',
        error: { detail: decision.reason },
      }),
      {
        status: decision.status,
        headers: { 'content-type': 'application/json' },
      },
    )
  }

  if (rejection) {
    const classified = interpretRequest(method, pathname)
    return rejectUnclassifiedWrite(user, via, method, pathname, rejection, {
      namespace: classified.namespace ?? createNs,
      repo: classified.repo ?? createRepo,
    })
  }

  const mutating = method !== 'GET' && method !== 'HEAD'
  const classified = interpretRequest(method, pathname)
  // List/detail namespace routes put the display name on `targetNamespace`, not `namespace`.
  const ns = classified.namespace ?? classified.targetNamespace ?? createNs
  const repo = classified.repo ?? createRepo

  if (mutating && isDatasetMutation(classified.action) && auditChainBlocked()) return auditChainBroken()

  const controlsResult = await resolveMutationControls({
    c,
    user,
    via,
    method,
    pathname,
    action: classified.action,
    message,
    signatureBody,
    ns,
    repo,
    mutating,
  })
  if (!controlsResult.ok) return controlsResult.response
  const { reason, changeControlId, signatureId, signatureRecord } = controlsResult.controls

  if (decision.aclBypass) {
    await recordAclBypassRead({
      user,
      via,
      method,
      pathname,
      namespace: createNs,
      repo: createRepo,
      reason: decision.reason,
    })
  }


  const lineage = createLineageCapture({
    method,
    pathname,
    moveNewPath,
    copyFrom,
    restoreFrom,
    user,
    via,
    fetchImpl: (input, init) => getUpstreamFetch()(input, init),
  })

  const datasetVersions = createDatasetCapture({
    method,
    pathname,
    action: classified.action,
    fetchImpl: (input, init) => getUpstreamFetch()(input, init),
  })

  const auditFields = (status: number, versions: DatasetVersions = {}) => ({
    actor: actorFromUser(user),
    via,
    method,
    path: pathname,
    status,
    action: classified.action,
    namespace: ns,
    repo,
    message,
    ...intentReasonFields({ reason, changeControlId, signatureId }),
    ...versions,
    detail: {
      ...(bodyWorkspaceId ? { workspace_id: bodyWorkspaceId } : {}),
      ...classified.detail,
      ...(moveNewPath ? { new_path: moveNewPath } : {}),
      ...(copyFrom ? { copy_from: copyFrom } : {}),
      ...(restoreFrom ? { restore_from: restoreFrom } : {}),
      ...(lineage.kind() ? { lineage_kind: lineage.kind() } : {}),
      ...(signatureId && signatureRecord
        ? mutationSignatureAuditDetail(signatureId, signatureRecord)
        : {}),
    },
  })

  // Fail closed: nothing reaches oxen unless the intent is on the chain.
  let intent: AuditEvent | undefined
  if (mutating) {
    try {
      intent = await appendIntent(auditFields(0))
    } catch (err) {
      if (err instanceof AuditDetailPolicyError) {
        return new Response(
          JSON.stringify({
            status: 'error',
            status_message: 'bad_request',
            error: { detail: err.message, code: err.code },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        )
      }
      return auditUnavailableResponse()
    }
  }

  // Validated default branch: no direct tip-changing writes (signed MR only).
  if (mutating) {
    const branch =
      (typeof classified.detail?.branch === 'string'
        ? classified.detail.branch
        : undefined) ?? branchTargetFromPath(pathname)
    const validated = decideValidatedBranchWrite({
      action: classified.action,
      branch,
    })
    if (!validated.allow) {
      if (intent) {
        const fields = auditFields(403)
        await appendOutcome(intent.id, {
          ...fields,
          detail: {
            ...fields.detail,
            validated_branch: true,
            branch: validated.branch,
            reason: validated.reason,
          },
        })
      }
      return new Response(
        JSON.stringify({
          status: 'error',
          status_message: 'forbidden',
          error: { detail: validated.reason, code: 'validated_branch' },
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      )
    }
  }

  // Repositories: 4-eyes self-merge check (authz already enforced the role floor above).
  let mergeAuthors: string[] | undefined
  if (mutating && classified.action === 'merge') {
    const loaded = await loadMergeAuthors(pathname, reqHeaders)
    if (!loaded.ok) {
      if (intent) {
        const fields = auditFields(503)
        await appendOutcome(intent.id, {
          ...fields,
          detail: { ...fields.detail, self_merge: true, reason: 'authors_unavailable' },
        })
      }
      return new Response(
        JSON.stringify({
          status: 'error',
          status_message: 'unavailable',
          error: { detail: 'Merge author check unavailable' },
        }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      )
    }
    const selfMerge = decideSelfMerge(user, loaded.authors)
    if (!selfMerge.allow) {
      if (intent) {
        const fields = auditFields(403)
        await appendOutcome(intent.id, {
          ...fields,
          detail: {
            ...fields.detail,
            ...selfMergeAuditDetail(user, loaded.authors, selfMerge),
          },
        })
      }
      return new Response(
        JSON.stringify({
          status: 'error',
          status_message: 'forbidden',
          error: { detail: selfMerge.reason },
        }),
        { status: 403, headers: { 'content-type': 'application/json' } },
      )
    }
    mergeAuthors = loaded.authors
  }

  // Display-name rename only: oxen physical keys are stable UUIDs (no in-place oxen rename).
  if (
    mutating &&
    ns &&
    repo &&
    method === 'PATCH' &&
    /\/rename\/?$/.test(pathname.replace(/\/+$/, '') || '/')
  ) {
    let nextName = ''
    // Prefer signatureBody (pre–author-injection). Injected `name` must never become the new repo name.
    const fromSignature =
      signatureBody && typeof signatureBody === 'object' && !Array.isArray(signatureBody)
        ? (signatureBody as Record<string, unknown>)
        : null
    if (fromSignature) {
      nextName = String(fromSignature.repo_name ?? fromSignature.name ?? '').trim()
    }
    if (!nextName) {
      try {
        const parsed =
          typeof body === 'string' ? (JSON.parse(body) as Record<string, unknown>) : {}
        nextName = String(parsed.repo_name ?? '').trim()
      } catch {
        nextName = ''
      }
    }
    if (!nextName) {
      if (intent) await appendOutcome(intent.id, auditFields(400))
      return new Response(
        JSON.stringify({
          status: 'error',
          status_message: 'bad_request',
          error: { detail: 'Repository name required' },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      )
    }
    if (nextName === repo) {
      if (intent) await appendOutcome(intent.id, { ...auditFields(400), change: EMPTY_AUDIT_CHANGE })
      return noChangeResponse()
    }
    const result = await renameRepository(ns, repo, nextName)
    if (!result.ok) {
      if (intent) await appendOutcome(intent.id, auditFields(400))
      return new Response(
        JSON.stringify({
          status: 'error',
          status_message: 'bad_request',
          error: { detail: result.error },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      )
    }
    const payload = JSON.stringify({
      status: 'success',
      status_message: 'resource_updated',
      repository: { namespace: ns, name: nextName },
    })
    if (intent) {
      await appendOutcome(intent.id, {
        ...auditFields(200),
        action: 'repo.rename',
        change: requireAuditChange({ name: repo }, { name: nextName }),
        repo: nextName,
        detail: { previous_name: repo, name: nextName },
      })
    }
    return new Response(payload, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  // Display names stay on the client/AuthZ path; oxen sees stable UUID keys.
  const mapped = await mapDisplayRequestToPhysical({
    pathname,
    body: typeof body === 'string' ? body : undefined,
    signatureBody,
    user,
    ns,
    repo,
    kind: classified.kind,
    action: classified.action,
  })
  if (!mapped.ok) {
    return new Response(
      JSON.stringify({
        status: 'error',
        status_message: 'forbidden',
        error: { detail: 'Cannot create repository: AuthZ namespace is missing or create is blocked' },
      }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )
  }
  const upstreamPath = mapped.path
  let upstreamBody: typeof body = mapped.body !== undefined ? mapped.body : body
  const createdPhysical: PhysicalRepoRef | null = mapped.createdPhysical
  const initialCommitMessage = mapped.initialCommitMessage
  /** Physical ids of the repo the request targets (before-state of a delete). */
  const physicalRepo = mapped.physicalRepo

  /** AuthZ settings snapshot for proxied `repo.metadata` (fail-closed when the repo is missing). */
  let metadataBefore: Record<string, unknown> | undefined
  let metadataAfter: Record<string, unknown> | undefined
  if (classified.action === 'repo.metadata' && ns && repo) {
    const { readRepository } = await import('../../authz/stores.js')
    const row = await readRepository(ns, repo)
    if (!row) {
      if (intent) await appendOutcome(intent.id, { ...auditFields(400), change: EMPTY_AUDIT_CHANGE })
      return new Response(
        JSON.stringify({
          status: 'error',
          status_message: 'bad_request',
          error: { detail: 'Repository not found', code: 'audit_change_unavailable' },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      )
    }
    metadataBefore = { name: row.name, description: row.description ?? '' }
    let nextDescription = row.description ?? ''
    const src =
      signatureBody && typeof signatureBody === 'object' && !Array.isArray(signatureBody)
        ? (signatureBody as Record<string, unknown>)
        : typeof body === 'string'
          ? (() => {
              try {
                return JSON.parse(body) as Record<string, unknown>
              } catch {
                return {}
              }
            })()
          : {}
    if (typeof src.description === 'string') nextDescription = src.description
    metadataAfter = { name: row.name, description: nextDescription }
  }

  // Empty-repo branch create: materialize missing `from_name` as an empty tip
  // (oxen cannot fork without a commit). No files are seeded.
  if (mutating && classified.action === 'branch.create' && ns && repo) {
    let fromName: string | undefined
    const fromSig =
      signatureBody && typeof signatureBody === 'object' && !Array.isArray(signatureBody)
        ? (signatureBody as Record<string, unknown>).from_name
        : undefined
    if (typeof fromSig === 'string') fromName = fromSig
    else if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body) as { from_name?: unknown }
        if (typeof parsed.from_name === 'string') fromName = parsed.from_name
      } catch {
        /* ignore */
      }
    }
    await ensureBranchCreateSourceTip(ns, repo, fromName, user)
  }

  // Fail closed: when the before-state of a mutation cannot be read, nothing reaches oxen.
  let upstream: Response | undefined
  let changeUnavailable = false
  try {
    await lineage.before()
    if (mutating) await datasetVersions.before()
    changeUnavailable =
      mutating &&
      (datasetVersions.baseState() === 'unavailable' ||
        lineage.beforeUnavailable() ||
        (classified.action === 'repo.delete' && !physicalRepo))
    if (!changeUnavailable) {
      upstream = await getUpstreamFetch()(
        `${env.oxenUpstream}${upstreamPath}${url.search}`,
        {
          method,
          headers: reqHeaders,
          body: upstreamBody,
          redirect: 'manual',
        },
      )
    }
  } catch (err) {
    if (intent) await appendOutcome(intent.id, auditFields(502))
    throw err
  }
  if (!upstream) {
    if (intent) await appendOutcome(intent.id, auditFields(503))
    return changeUnavailableResponse()
  }

  let responseBody: BodyInit | null = upstream.body
  const upstreamIsJson = (upstream.headers.get('content-type') ?? '').includes('application/json')

  const filteredCatalog = await filterNamespaceCatalog(user, method, pathname, upstream)
  if (filteredCatalog !== null) responseBody = filteredCatalog

  const stampedDetail = await stampRepositoryIdOnRepoDetail(method, pathname, upstream)
  if (stampedDetail !== null) responseBody = stampedDetail

  if (intent) {
    // Buffered once: the dataset versions and the lineage op both read the answer, and the caller is served it.
    let buffered: string | undefined
    if (upstream.ok && upstreamIsJson && typeof responseBody !== 'string') {
      try {
        buffered = await upstream.text()
      } catch {
        buffered = undefined
      }
      if (buffered !== undefined) responseBody = buffered
    } else if (typeof responseBody === 'string') {
      buffered = responseBody
    }

    const versions = datasetVersions.after(upstream, buffered)
    let change: AuditChange
    try {
      change = proxyMutationChange({
        action: classified.action,
        upstreamOk: upstream.ok,
        namespace: ns,
        repo,
        branch: datasetVersions.branch(),
        base: datasetVersions.base(),
        head: versions.dataset?.head,
        fileDeltas: await lineage.fileDeltas(upstream),
        paths: workspaceFilePathsFromPathname(pathname),
        repositoryId:
          classified.action === 'repo.create'
            ? createdPhysical?.repositoryId
            : physicalRepo?.repositoryId,
        workspaceId:
          (typeof classified.detail?.workspace_id === 'string' ? classified.detail.workspace_id : undefined) ??
          bodyWorkspaceId ??
          workspaceIdFromAnswer(buffered),
        ...(metadataBefore && metadataAfter
          ? { metadataBefore, metadataAfter }
          : {}),
      })
    } catch (err) {
      if (!(err instanceof NoChangeError)) throw err
      // The upstream already answered, but nothing changed: refuse, and audit no mutation.
      await appendOutcome(intent.id, { ...auditFields(400), change: EMPTY_AUDIT_CHANGE })
      return noChangeResponse()
    }
    const outcomeFields = auditFields(upstream.status, versions)
    const auditEvent = await appendOutcome(intent.id, {
      ...outcomeFields,
      change,
      detail: {
        ...outcomeFields.detail,
        ...(mergeAuthors
          ? selfMergeAuditDetail(user, mergeAuthors, { allow: true })
          : {}),
      },
    })
    await lineage.after(upstream, buffered, auditEvent?.id)

    // Tip moved → mark open MRs that pin this branch as stale (#158).
    if (upstream.ok && mutating && ns && repo) {
      try {
        await markStaleAfterProxiedTipWrite({
          namespace: ns,
          repo,
          action: classified.action,
          pathname,
          detailBranch:
            typeof classified.detail?.branch === 'string'
              ? classified.detail.branch
              : undefined,
        })
      } catch {
        /* best-effort; list/detail/signing-preview reconcile is the safety net */
      }
    }

    // Create: AuthZ was minted before oxen; stamp id + restore display names on the answer.
    if (
      upstream.ok &&
      createdPhysical &&
      ns &&
      repo &&
      typeof responseBody === 'string'
    ) {
      responseBody = await finalizeProxiedRepoCreate(user, ns, repo, responseBody, {
        initialCommitMessage,
      })
    }
  }

  // GET list/detail must be buffered too — otherwise clients see oxen UUID keys and navigate to them.
  if (upstream.ok && upstreamIsJson && typeof responseBody !== 'string' && responseBody != null) {
    try {
      responseBody =
        responseBody === upstream.body
          ? await upstream.text()
          : await new Response(responseBody).text()
    } catch {
      /* leave body as-is */
    }
  }

  // Swap physical UUID keys in oxen JSON back to display names for clients.
  if (typeof responseBody === 'string' && upstreamIsJson) {
    responseBody = await mapPhysicalResponseToDisplay(responseBody, {
      createdPhysical,
      displayNs: ns,
      displayRepo: repo,
    })
    const { rewriteCommitAuthorsInOxenJson } = await import('../../merge/index.js')
    responseBody = await rewriteCommitAuthorsInOxenJson(responseBody)
  }

  const resHeaders = new Headers()
  upstream.headers.forEach((value, key) => {
    if (HOP_BY_HOP.has(key.toLowerCase())) return
    resHeaders.set(key, value)
  })
  // Body may have been rewritten (namespace ACL filter / lineage buffer).
  if (typeof responseBody === 'string') {
    resHeaders.delete('content-length')
  }

  return new Response(responseBody, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  })
}
