import { authzActionForPath, minRoleForAction } from './authzPathMap.js'
import type { RepoRole } from './authzTypes.js'

/** How authorization must treat a request; `other` is default-deny. */
export type RouteKind =
  | 'public'
  | 'namespace.list'
  | 'namespace.detail'
  | 'namespace.create'
  | 'repo.create'
  | 'repo.list'
  | 'repo'
  | 'other'

export type RequestInterpretation = {
  kind: RouteKind
  /** Namespace named by the path of namespace.detail / repo.list routes. */
  targetNamespace?: string
  /** Audit label. */
  action: string
  /** Action authorization keys on (push routes differ from the audit label). */
  authzAction: string
  namespace?: string
  repo?: string
  detail?: Record<string, unknown>
  /** Minimum repo role; unknown mutating routes fail closed to admin. */
  minRole: RepoRole
}

/** Coarse audit action + ns/repo from oxen API path. */
export function classifyPath(
  method: string,
  pathname: string,
): {
  action: string
  namespace?: string
  repo?: string
  detail?: Record<string, unknown>
} {
  const path = pathname.replace(/\/+$/, '') || '/'
  const parts = path.split('/').filter(Boolean)
  // Expect: api, repos, ns, repo, ...
  if (parts[0] !== 'api') {
    return { action: 'other' }
  }

  if (parts[1] === 'repos' && parts.length === 2 && method === 'POST') {
    return { action: 'repo.create' }
  }

  if (parts[1] === 'repos' && parts.length >= 4) {
    const namespace = safeDecode(parts[2])
    const repo = safeDecode(parts[3])
    const rest = parts.slice(4)

    if (rest[0] === 'commits' && rest.length === 3 &&
        rest[2] === 'complete' && method === 'POST') {
      return {
        action: 'commit.publish',
        namespace,
        repo,
        detail: { commit_id: safeDecode(rest[1]) },
      }
    }
    if (rest[0] === 'file') {
      const branch = rest[1] ? safeDecode(rest[1]) : undefined
      const filePath = rest.slice(2).map(safeDecode).join('/')
      return {
        action: method === 'DELETE' ? 'file.delete' : 'file.write',
        namespace,
        repo,
        detail: {
          ...(branch ? { branch } : {}),
          ...(filePath ? { path: filePath } : {}),
        },
      }
    }
    if (rest[0] === 'branches') {
      const branch = rest[1] ? safeDecode(rest[1]) : undefined
      let action = 'branch.other'
      if (method === 'POST' && rest.length === 1) action = 'branch.create'
      else if (method === 'DELETE') action = 'branch.delete'
      else if (method === 'PUT' || method === 'PATCH') action = 'branch.update'
      return {
        action,
        namespace,
        repo,
        detail: branch ? { branch } : undefined,
      }
    }
    if (rest[0] === 'merge' || rest[0] === 'merges') {
      return { action: 'merge', namespace, repo }
    }
    if (rest[0] === 'workspaces') {
      // All workspace.* actions share the `workspace` prefix, which authz keys on.
      const workspaceId = rest[1] ? safeDecode(rest[1]) : undefined
      const sub = rest[2]
      let action = 'workspace.other'
      if (method === 'POST' && rest.length === 1) action = 'workspace.create'
      else if (method === 'DELETE' && rest.length === 2) {
        action = 'workspace.delete'
      } else if (sub === 'commit') action = 'workspace.commit'
      else if (sub === 'merge') action = 'workspace.merge'
      else if (sub === 'files') {
        action =
          method === 'DELETE' ? 'workspace.file.delete' : 'workspace.file.write'
      }
      return {
        action,
        namespace,
        repo,
        detail: workspaceId ? { workspace_id: workspaceId } : undefined,
      }
    }
    if (method === 'DELETE' && rest.length === 0) {
      return { action: 'repo.delete', namespace, repo }
    }
    // Repo-level metadata mutate (PATCH/PUT on repo root or settings-ish paths).
    if (
      (method === 'PATCH' || method === 'PUT') &&
      (rest.length === 0 || rest[0] === 'settings' || rest[0] === 'meta')
    ) {
      return { action: 'repo.metadata', namespace, repo }
    }
    return { action: 'other', namespace, repo }
  }

  if (parts[1] === 'namespaces' && method === 'POST') {
    return { action: 'namespace.create' }
  }

  return { action: 'other' }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Single interpretation of an oxen API request, shared by audit and authorization. */
export function interpretRequest(method: string, pathname: string): RequestInterpretation {
  const m = method.toUpperCase()
  const classified = classifyPath(m, pathname)
  const authzAction = authzActionForPath(m, pathname, classified.action)
  const minRole: RepoRole =
    m === 'GET' || m === 'HEAD' ? 'read' : (minRoleForAction(authzAction) ?? 'admin')
  const { kind, targetNamespace } = routeKind(m, pathname, classified)
  return { ...classified, kind, targetNamespace, authzAction, minRole }
}

function routeKind(
  method: string,
  pathname: string,
  classified: { action: string; namespace?: string; repo?: string },
): { kind: RouteKind; targetNamespace?: string } {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/api/version' || path === '/api/health' || path === '/api/oxen_version') {
    return { kind: 'public' }
  }
  const parts = path.split('/').filter(Boolean)
  const read = method === 'GET' || method === 'HEAD'
  if (parts[0] === 'api' && parts[1] === 'namespaces' && read) {
    if (parts.length >= 3) return { kind: 'namespace.detail', targetNamespace: safeDecode(parts[2]!) }
    return { kind: 'namespace.list' }
  }
  if (classified.action === 'namespace.create') return { kind: 'namespace.create' }
  if (classified.action === 'repo.create' || (path === '/api/repos' && method === 'POST')) {
    return { kind: 'repo.create' }
  }
  if (parts[0] === 'api' && parts[1] === 'repos' && parts.length === 3 && read) {
    return { kind: 'repo.list', targetNamespace: safeDecode(parts[2]!) }
  }
  if (classified.namespace && classified.repo) return { kind: 'repo' }
  return { kind: 'other' }
}
