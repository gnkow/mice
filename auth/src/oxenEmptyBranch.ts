/**
 * Oxen cannot POST /branches without an existing tip. On an empty repo the
 * workspace-create path materializes an init commit and the named branch (no
 * files) — that is Mice's empty default / empty branch tip.
 *
 * oxen-server hardcodes that commit as Oxen/oxen@oxen.ai with its own message
 * (API author/message fields are ignored). Mice therefore requires a BFF actor
 * and records commit attribution so the proxy can rewrite identity and message
 * on the way out (default message: "Initialized Repo").
 */

import {
  humanCommitFields,
  type HumanCommitFields,
} from './authentication/commits/commitIdentity.js'
import type { PrincipalId } from './authentication/session/principal.js'
import {
  normalizeEmptyTipMessage,
  recordCommitAttribution,
} from './commitAttributionStore.js'

export type EmptyTipOptions = {
  /** Commit message shown after BFF rewrite (oxen still writes its own). */
  message?: string
}

function oxenUpstream(): string {
  return (process.env.OXEN_UPSTREAM || 'http://127.0.0.1:3001').replace(/\/$/, '')
}

function repoBase(namespaceId: string, repositoryId: string): string {
  return `${oxenUpstream()}/api/repos/${encodeURIComponent(namespaceId)}/${encodeURIComponent(repositoryId)}`
}

async function listBranchNames(
  namespaceId: string,
  repositoryId: string,
): Promise<string[]> {
  const res = await fetch(`${repoBase(namespaceId, repositoryId)}/branches`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) return []
  const body = (await res.json()) as { branches?: Array<{ name?: string }> }
  return (body.branches ?? []).map((b) => b.name).filter((n): n is string => !!n)
}

export type EmptyBranchActor = PrincipalId & { email: string; name?: string }

/**
 * Ensure `branch` exists as an empty tip (init commit, no files).
 * Idempotent when the branch is already present. Talks to oxen directly so
 * validated-branch write gates on the BFF do not block bootstrap — but identity
 * is still attributed to `actor` via {@link recordCommitAttribution}.
 */
export async function ensureEmptyOxenBranch(
  namespaceId: string,
  repositoryId: string,
  branch: string,
  actor: EmptyBranchActor,
  options?: EmptyTipOptions,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const name = branch.trim()
  if (!name) return { ok: false, error: 'branch name required' }
  if (!actor.email?.trim() || !actor.sub?.trim() || !actor.iss?.trim()) {
    return { ok: false, error: 'actor identity required for empty-tip attribution' }
  }

  const fields: HumanCommitFields & { name?: string; message: string } = {
    ...humanCommitFields(actor),
    name: actor.name?.trim() || undefined,
    message: normalizeEmptyTipMessage(options?.message),
  }

  try {
    const existing = await listBranchNames(namespaceId, repositoryId)
    if (existing.includes(name)) {
      const attributed = await attributeBranchTip(namespaceId, repositoryId, name, fields)
      if (!attributed.ok) return attributed
      return { ok: true }
    }

    const base = repoBase(namespaceId, repositoryId)
    const workspaceId = `mice-empty-${name}-${Date.now().toString(36)}`
    const create = await fetch(`${base}/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, branch_name: name }),
    })
    if (!create.ok) {
      const text = await create.text().catch(() => '')
      // Race: another create may have filled the tip first.
      if ((await listBranchNames(namespaceId, repositoryId)).includes(name)) {
        const attributed = await attributeBranchTip(namespaceId, repositoryId, name, fields)
        if (!attributed.ok) return attributed
        return { ok: true }
      }
      return {
        ok: false,
        error: `oxen workspace init failed (${create.status})${text ? `: ${text.slice(0, 200)}` : ''}`,
      }
    }

    const created = (await create.json().catch(() => null)) as {
      workspace?: { commit?: { id?: string } }
    } | null
    const commitId = created?.workspace?.commit?.id?.trim()
    if (commitId) {
      await attributeCommit(commitId, fields)
    }

    await fetch(`${base}/workspaces/${encodeURIComponent(workspaceId)}`, {
      method: 'DELETE',
    }).catch(() => undefined)

    if ((await listBranchNames(namespaceId, repositoryId)).includes(name)) {
      if (!commitId) {
        const attributed = await attributeBranchTip(namespaceId, repositoryId, name, fields)
        if (!attributed.ok) return attributed
      }
      return { ok: true }
    }
    return { ok: false, error: `oxen empty branch ${name} did not appear after workspace init` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function attributeCommit(
  commitId: string,
  fields: HumanCommitFields & { name?: string; message?: string },
): Promise<void> {
  await recordCommitAttribution(commitId, fields)
}

async function attributeBranchTip(
  namespaceId: string,
  repositoryId: string,
  branch: string,
  fields: HumanCommitFields & { name?: string; message?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(`${repoBase(namespaceId, repositoryId)}/branches`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    return { ok: false, error: `could not list branches to attribute tip (${res.status})` }
  }
  const body = (await res.json()) as {
    branches?: Array<{ name?: string; commit_id?: string }>
  }
  const tip = body.branches?.find((b) => b.name === branch)?.commit_id?.trim()
  if (!tip) {
    return { ok: false, error: `branch ${branch} has no tip commit to attribute` }
  }
  await attributeCommit(tip, fields)
  return { ok: true }
}
