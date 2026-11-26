import { authzActionForPath, minRoleForAction } from '../../../authz/path.js'
import type { RepoRole } from '../../../authz/types.js'

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

export type PathClassification = {
  action: string
  namespace?: string
  repo?: string
  detail?: Record<string, unknown>
  /**
   * False for unknown mutating routes: the proxy must reject them.
   * They are never written as ledger operations (no `other` catch-all).
   */
  recognized: boolean
}

export type RequestInterpretation = PathClassification & {
  kind: RouteKind
  /** Namespace named by the path of namespace.detail / repo.list routes. */
  targetNamespace?: string
  /** Action authorization keys on (push routes differ from the audit label). */
  authzAction: string
  /** Minimum repo role; unrecognized mutating routes are rejected before this applies. */
  minRole: RepoRole
}

const readMethod = (method: string) => {
  const m = method.toUpperCase()
  return m === 'GET' || m === 'HEAD'
}

/** Coarse audit action + ns/repo from oxen API path. */
export function classifyPath(method: string, pathname: string): PathClassification {
  const m = method.toUpperCase()
  const path = pathname.replace(/\/+$/, '') || '/'
  const parts = path.split('/').filter(Boolean)
  const isRead = readMethod(m)

  if (parts[0] !== 'api') {
    return { action: 'unclassified', recognized: isRead }
  }

  if (parts[1] === 'repos' && parts.length === 2 && m === 'POST') {
    return { action: 'repo.create', recognized: true }
  }

  if (parts[1] === 'repos' && parts.length >= 4) {
    const namespace = safeDecode(parts[2]!)
    const repo = safeDecode(parts[3]!)
    const rest = parts.slice(4)
    const scoped = { namespace, repo }

    if (rest[0] === 'commits') {
      if (rest.length === 3 && rest[2] === 'complete' && m === 'POST') {
        return {
          action: 'commit.publish',
          ...scoped,
          recognized: true,
          detail: { commit_id: safeDecode(rest[1]!) },
        }
      }
      // Oxen push transport (chunk upload before complete).
      if (m === 'POST' && (rest[1] === 'upload' || rest.length >= 2)) {
        return {
          action: 'commit.upload',
          ...scoped,
          recognized: true,
          detail: rest[1] && rest[1] !== 'upload' ? { commit_id: safeDecode(rest[1]) } : undefined,
        }
      }
      if (isRead) return { action: 'repo.read', ...scoped, recognized: true }
      return { action: 'unclassified', ...scoped, recognized: false }
    }

    if (rest[0] === 'file') {
      if (isRead) {
        return {
          action: 'repo.read',
          ...scoped,
          recognized: true,
          detail: {
            ...(rest[1] ? { branch: safeDecode(rest[1]) } : {}),
            ...(rest.length > 2 ? { path: rest.slice(2).map(safeDecode).join('/') } : {}),
          },
        }
      }
      const branch = rest[1] ? safeDecode(rest[1]) : undefined
      const filePath = rest.slice(2).map(safeDecode).join('/')
      return {
        action: m === 'DELETE' ? 'file.delete' : 'file.write',
        ...scoped,
        recognized: true,
        detail: {
          ...(branch ? { branch } : {}),
          ...(filePath ? { path: filePath } : {}),
        },
      }
    }

    if (rest[0] === 'branches') {
      const branch = rest[1] ? safeDecode(rest[1]) : undefined
      if (m === 'POST' && rest.length === 1) {
        return { action: 'branch.create', ...scoped, recognized: true, detail: branch ? { branch } : undefined }
      }
      if (m === 'DELETE') {
        return { action: 'branch.delete', ...scoped, recognized: true, detail: branch ? { branch } : undefined }
      }
      if (m === 'PUT' || m === 'PATCH') {
        return { action: 'branch.update', ...scoped, recognized: true, detail: branch ? { branch } : undefined }
      }
      if (isRead) return { action: 'repo.read', ...scoped, recognized: true, detail: branch ? { branch } : undefined }
      return { action: 'unclassified', ...scoped, recognized: false }
    }

    if (rest[0] === 'merge' || rest[0] === 'merges') {
      if (isRead) return { action: 'repo.read', ...scoped, recognized: true }
      const range = rest[1] ? safeDecode(rest[1]) : undefined
      const target = range?.split('..')[0]?.trim()
      return {
        action: 'merge',
        ...scoped,
        recognized: true,
        detail: target ? { branch: target } : undefined,
      }
    }

    if (rest[0] === 'workspaces') {
      const workspaceId = rest[1] ? safeDecode(rest[1]) : undefined
      const sub = rest[2]
      const branch = rest[3] ? safeDecode(rest[3]) : undefined
      const detail = {
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
        ...(branch && (sub === 'commit' || sub === 'merge') ? { branch } : {}),
      }
      if (m === 'POST' && rest.length === 1) {
        return { action: 'workspace.create', ...scoped, recognized: true, detail }
      }
      if (m === 'DELETE' && rest.length === 2) {
        return { action: 'workspace.delete', ...scoped, recognized: true, detail }
      }
      if (sub === 'commit') return { action: 'workspace.commit', ...scoped, recognized: true, detail }
      if (sub === 'merge') return { action: 'workspace.merge', ...scoped, recognized: true, detail }
      if (sub === 'files' || sub === 'changes') {
        return {
          action: m === 'DELETE' ? 'workspace.file.delete' : isRead ? 'repo.read' : 'workspace.file.write',
          ...scoped,
          recognized: true,
          detail,
        }
      }
      if (isRead) return { action: 'repo.read', ...scoped, recognized: true, detail }
      return { action: 'unclassified', ...scoped, recognized: false }
    }

    if (rest[0] === 'versions') {
      if (m === 'QUERY') return { action: 'versions.query', ...scoped, recognized: true }
      // Push transport over the versions API (authz remaps to `push`).
      if (m === 'POST' || m === 'PUT') return { action: 'commit.upload', ...scoped, recognized: true }
      if (isRead) return { action: 'repo.read', ...scoped, recognized: true }
      return { action: 'unclassified', ...scoped, recognized: false }
    }

    if (m === 'DELETE' && rest.length === 0) {
      return { action: 'repo.delete', ...scoped, recognized: true }
    }

    if (
      (m === 'PATCH' || m === 'PUT') &&
      (rest.length === 0 ||
        rest[0] === 'settings' ||
        rest[0] === 'meta' ||
        rest[0] === 'rename' ||
        rest[0] === 'transfer')
    ) {
      return { action: 'repo.metadata', ...scoped, recognized: true }
    }

    // Known repo scope, unknown sub-route: reads may proxy; mutations are refused.
    if (isRead) return { action: 'repo.read', ...scoped, recognized: true }
    return { action: 'unclassified', ...scoped, recognized: false }
  }

  if (parts[1] === 'namespaces' && m === 'POST') {
    return { action: 'namespace.create', recognized: true }
  }

  if (isRead) return { action: 'unclassified', recognized: true }
  return { action: 'unclassified', recognized: false }
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
