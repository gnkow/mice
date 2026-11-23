import {
  CHANGE_CONTROL_HEADER,
  REASON_HEADER,
  SIGNATURE_HEADER,
} from './reason'

export type MergeRequestStatus = 'open' | 'stale' | 'merged' | 'blocked'

export type MergeRequest = {
  id: string
  repositoryId: string
  namespace: string
  repo: string
  sourceBranch: string
  targetBranch: string
  expectedSourceHead: string
  expectedTargetHead: string
  status: MergeRequestStatus
  openedBy: string
  title: string
  description: string
  mergeCommitId: string | null
  createdAt: string
  updatedAt: string
}

/** Display title when the API returns an empty legacy title. */
export function mergeRequestTitle(mr: Pick<MergeRequest, 'title' | 'sourceBranch' | 'targetBranch'>): string {
  const t = mr.title?.trim()
  return t || `${mr.sourceBranch} → ${mr.targetBranch}`
}

export type MergeSigningPreview = {
  mergeRequest: MergeRequest
  meaning: 'Approved'
  content: string
  hash: string
  binding: {
    repo: string
    sourceHead: string
    targetHead: string
    manifestDigest: string
  }
  manifest: string
  manifestEntries: Array<{ path: string; contentHash: string }>
  validatedTarget: boolean
  principal: { iss: string; sub: string; name: string }
}

export type MergeRefusalCode =
  | 'not_open'
  | 'not_approver'
  | 'self_merge'
  | 'head_mismatch'
  | 'binding_mismatch'
  | 'meaning'
  | 'change_control'
  | 'not_validated'
  | 'restore_test_required'
  | 'signature_invalid'
  | 'audit_unavailable'

const REFUSAL_COPY: Record<string, string> = {
  not_approver: 'You need the Approver role for this repository to sign the merge.',
  self_merge:
    'Self-merge forbidden (4-eyes): you cannot approve this merge if you opened the request or authored commits in the range.',
  head_mismatch: 'Source or target moved since this preview. Resync the merge request and try again.',
  not_open: 'This merge request is not open (it may be stale, merged, or blocked).',
  already_open:
    'A merge request for this source and target branch is already open. Open that request instead of creating another.',
  binding_mismatch: 'Content changed after display; the pending signature is invalid.',
  restore_test_required: 'A restore test must pass before the first regulated merge.',
  not_validated: 'Target branch is not validated; use the unsigned merge path.',
  signature_invalid: 'The signature is missing, expired, or does not match this merge.',
  audit_unavailable: 'Audit is unavailable; nothing was saved. Try again when audit is healthy.',
}

export function mergeRefusalMessage(code: string | undefined, fallback: string): string {
  if (code && REFUSAL_COPY[code]) return REFUSAL_COPY[code]
  return fallback
}

/** Same comparison form as auth `signerAuthorKey` / commit `iss|sub`. */
export function principalAuthorKey(principal: { iss: string; sub: string }): string {
  return `${principal.iss.trim()}|${principal.sub.trim()}`
}

/**
 * Normalize AuthZ `iss\\u001fsub` / `iss|sub` / bare keys to the commit-author form.
 * Mirrors auth `normalizePrincipalAuthorKey` for UI self-sign fading.
 */
export function normalizePrincipalAuthorKey(raw: string): string {
  const trimmed = raw.trim()
  const us = trimmed.indexOf('\u001f')
  if (us > 0 && us < trimmed.length - 1) {
    return principalAuthorKey({
      iss: trimmed.slice(0, us),
      sub: trimmed.slice(us + 1),
    })
  }
  const bar = trimmed.indexOf('|')
  if (bar > 0 && bar < trimmed.length - 1) {
    return principalAuthorKey({
      iss: trimmed.slice(0, bar),
      sub: trimmed.slice(bar + 1),
    })
  }
  return trimmed
}

/**
 * Client preview of the 4-eyes self-merge rule: opener or any commit author
 * matching the would-be signer cannot Sign.
 */
export function isSelfSignBlocked(input: {
  signer: { iss: string; sub: string } | null | undefined
  openedBy?: string | null
  commitAuthors?: readonly string[]
}): boolean {
  if (!input.signer?.iss || !input.signer?.sub) return false
  const key = principalAuthorKey(input.signer)
  if (input.openedBy?.trim() && normalizePrincipalAuthorKey(input.openedBy) === key) {
    return true
  }
  for (const author of input.commitAuthors ?? []) {
    if (normalizePrincipalAuthorKey(author) === key) return true
  }
  return false
}

async function readError(res: Response): Promise<{ error: string; code?: string }> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string }
  return {
    error: typeof body.error === 'string' ? body.error : `Request failed (${res.status})`,
    code: typeof body.code === 'string' ? body.code : undefined,
  }
}

export async function listMergeRequests(
  namespace: string,
  repo: string,
  signal?: AbortSignal,
): Promise<MergeRequest[]> {
  const res = await fetch(
    `/auth/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/merge-requests`,
    { credentials: 'same-origin', signal },
  )
  if (!res.ok) {
    const err = await readError(res)
    throw new Error(err.error)
  }
  const body = (await res.json()) as { mergeRequests: MergeRequest[] }
  return body.mergeRequests ?? []
}

export async function getMergeRequest(id: string, signal?: AbortSignal): Promise<MergeRequest> {
  const res = await fetch(`/auth/merge-requests/${encodeURIComponent(id)}`, {
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) {
    const err = await readError(res)
    throw new Error(err.error)
  }
  const body = (await res.json()) as { mergeRequest: MergeRequest }
  return body.mergeRequest
}

export async function openMergeRequest(
  namespace: string,
  repo: string,
  input: {
    sourceBranch: string
    targetBranch: string
    expectedSourceHead: string
    expectedTargetHead: string
    commitIds?: string[]
    title: string
    description?: string
    reason: string
    signatureId: string
    changeControlId?: string
  },
): Promise<MergeRequest> {
  const res = await fetch(
    `/auth/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/merge-requests`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        [REASON_HEADER]: input.reason,
        [SIGNATURE_HEADER]: input.signatureId,
        ...(input.changeControlId
          ? { [CHANGE_CONTROL_HEADER]: input.changeControlId }
          : {}),
      },
      body: JSON.stringify({
        sourceBranch: input.sourceBranch,
        targetBranch: input.targetBranch,
        expectedSourceHead: input.expectedSourceHead,
        expectedTargetHead: input.expectedTargetHead,
        title: input.title,
        description: input.description ?? '',
        ...(input.commitIds ? { commitIds: input.commitIds } : {}),
      }),
    },
  )
  if (!res.ok) {
    const err = await readError(res)
    throw new Error(mergeRefusalMessage(err.code, err.error))
  }
  const body = (await res.json()) as { mergeRequest: MergeRequest }
  return body.mergeRequest
}

export async function fetchSigningPreview(
  id: string,
  signal?: AbortSignal,
): Promise<MergeSigningPreview> {
  const res = await fetch(`/auth/merge-requests/${encodeURIComponent(id)}/signing-preview`, {
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) {
    const err = await readError(res)
    throw new Error(err.error)
  }
  return (await res.json()) as MergeSigningPreview
}

export async function rejectMergeRequest(
  id: string,
  ceremony: { reason: string; signatureId: string; changeControlId?: string },
): Promise<MergeRequest> {
  const res = await fetch(`/auth/merge-requests/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      [REASON_HEADER]: ceremony.reason,
      [SIGNATURE_HEADER]: ceremony.signatureId,
      ...(ceremony.changeControlId
        ? { [CHANGE_CONTROL_HEADER]: ceremony.changeControlId }
        : {}),
    },
    body: JSON.stringify({}),
  })
  if (!res.ok) {
    const err = await readError(res)
    throw new Error(err.error)
  }
  const body = (await res.json()) as { mergeRequest: MergeRequest }
  return body.mergeRequest
}

export async function resyncMergeRequest(
  id: string,
  live: { liveSourceHead: string; liveTargetHead: string; refreshExpected?: boolean },
  ceremony: { reason: string; signatureId: string; changeControlId?: string },
): Promise<MergeRequest> {
  const res = await fetch(`/auth/merge-requests/${encodeURIComponent(id)}/resync`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      [REASON_HEADER]: ceremony.reason,
      [SIGNATURE_HEADER]: ceremony.signatureId,
      ...(ceremony.changeControlId
        ? { [CHANGE_CONTROL_HEADER]: ceremony.changeControlId }
        : {}),
    },
    body: JSON.stringify(live),
  })
  if (!res.ok) {
    const err = await readError(res)
    throw new Error(err.error)
  }
  const body = (await res.json()) as { mergeRequest: MergeRequest }
  return body.mergeRequest
}

export async function completeSignedMergeRequest(
  id: string,
  input: {
    liveSourceHead: string
    liveTargetHead: string
    authors: string[]
    commitIds: string[]
    signatureId: string
    reason: string
    changeControlId?: string
  },
): Promise<{ mergeRequest: MergeRequest; mergeCommitId: string }> {
  const res = await fetch(`/auth/merge-requests/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      [REASON_HEADER]: input.reason,
      [SIGNATURE_HEADER]: input.signatureId,
      ...(input.changeControlId
        ? { [CHANGE_CONTROL_HEADER]: input.changeControlId }
        : {}),
    },
    body: JSON.stringify({
      liveSourceHead: input.liveSourceHead,
      liveTargetHead: input.liveTargetHead,
      authors: input.authors,
      commitIds: input.commitIds,
      signatureId: input.signatureId,
    }),
  })
  if (!res.ok) {
    const err = await readError(res)
    throw Object.assign(new Error(mergeRefusalMessage(err.code, err.error)), {
      code: err.code,
      status: res.status,
    })
  }
  return (await res.json()) as { mergeRequest: MergeRequest; mergeCommitId: string }
}

export async function executeMergeSignature(input: {
  content: string
  expectedHash: string
  binding: MergeSigningPreview['binding']
  manifest: string
  changeControlId?: string
}): Promise<{ id: string; changeControlId?: string; hash: string }> {
  const res = await fetch('/auth/sign/execute', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Always send a string — JSON omits `undefined`, which the BFF reports as "content required".
      content: input.content ?? input.manifest ?? '',
      meaning: 'Approved',
      expectedHash: input.expectedHash,
      binding: input.binding,
      manifest: input.manifest ?? '',
      ...(input.changeControlId ? { changeControlId: input.changeControlId } : {}),
    }),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw Object.assign(
      new Error(
        typeof body.error === 'string' ? body.error : `Signature failed (${res.status})`,
      ),
      { status: res.status, body },
    )
  }
  const signature = body.signature as { id: string; changeControlId?: string; hash: string }
  if (!signature?.id) throw new Error('Signature failed (missing id)')
  return signature
}
