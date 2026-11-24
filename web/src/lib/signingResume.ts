/** sessionStorage: resume a signed mutation after IdP step-up / MFA (full navigation). */

import {
  CHANGE_CONTROL_HEADER,
  REASON_HEADER,
  SIGNATURE_HEADER,
  withReason,
  type ReasonSubmission,
} from './reason'

export const SIGNING_RESUME_KEY = 'mice.signing.resume'

const TTL_MS = 15 * 60 * 1000

/** Interrupted regulated mutation to replay after reauth (Approve / Grant / etc.). */
export type PendingSignedMutation = {
  kind: 'signed_mutation'
  /** Browser path (incl. hash) so we only resume on the same page. */
  path: string
  at: number
  method: string
  apiPath: string
  body?: unknown
  changeSummary?: string
  draftReason?: string
  draftChangeControlId?: string
}

export type SigningResumeIntent = PendingSignedMutation

/** @deprecated Kept so old stashes clear cleanly; prefer PendingSignedMutation. */
export type SigningResumeNotice = {
  path: string
  message: string
  at: number
}

/** Current page including hash so reauth returns to the Settings section in view. */
export function pageResumePath(
  loc: Pick<Location, 'pathname' | 'search' | 'hash'> = window.location,
): string {
  return `${loc.pathname}${loc.search}${loc.hash}`
}

function pathBasesMatch(a: string, b: string): boolean {
  const base = (p: string) => p.split('#')[0] ?? p
  return base(a) === base(b)
}

function isPendingSignedMutation(value: unknown): value is PendingSignedMutation {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v.kind === 'signed_mutation' &&
    typeof v.path === 'string' &&
    typeof v.at === 'number' &&
    typeof v.method === 'string' &&
    typeof v.apiPath === 'string'
  )
}

/** Stash the in-flight mutation before navigating to `/auth/reauth`. */
export function stashPendingSignedMutation(
  intent: Omit<PendingSignedMutation, 'kind' | 'at'> & { at?: number },
): void {
  try {
    const payload: PendingSignedMutation = {
      kind: 'signed_mutation',
      path: intent.path,
      at: intent.at ?? Date.now(),
      method: intent.method,
      apiPath: intent.apiPath,
      ...(intent.body !== undefined ? { body: intent.body } : {}),
      ...(intent.changeSummary ? { changeSummary: intent.changeSummary } : {}),
      ...(intent.draftReason ? { draftReason: intent.draftReason } : {}),
      ...(intent.draftChangeControlId
        ? { draftChangeControlId: intent.draftChangeControlId }
        : {}),
    }
    sessionStorage.setItem(SIGNING_RESUME_KEY, JSON.stringify(payload))
  } catch {
    /* private mode / quota — best-effort */
  }
}

/**
 * Read + clear storage once per tab load (module-held) so React Strict Mode
 * remounts share the same resume promise instead of losing the stash.
 */
let heldIntent: PendingSignedMutation | null | undefined
let resumePromise: Promise<Response> | null = null
let ceremonyDraft: {
  reason: string
  changeControlId?: string
} | null = null

function loadHeldIntent(): PendingSignedMutation | null {
  if (heldIntent !== undefined) return heldIntent
  try {
    const raw = sessionStorage.getItem(SIGNING_RESUME_KEY)
    sessionStorage.removeItem(SIGNING_RESUME_KEY)
    if (!raw) {
      heldIntent = null
      return null
    }
    const parsed = JSON.parse(raw) as unknown
    if (!isPendingSignedMutation(parsed)) {
      heldIntent = null
      return null
    }
    if (Date.now() - parsed.at > TTL_MS) {
      heldIntent = null
      return null
    }
    heldIntent = parsed
    return heldIntent
  } catch {
    heldIntent = null
    return null
  }
}

/** Draft reason/CC to prefill when the ceremony reopens after MFA. */
export function takeCeremonyResumeDraft(): {
  reason: string
  changeControlId?: string
} | null {
  const d = ceremonyDraft
  ceremonyDraft = null
  return d
}

export type ResumeHandle = {
  intent: PendingSignedMutation
  promise: Promise<Response>
}

/**
 * If a fresh pending mutation matches this page, start (or join) a single resume.
 * Returns null when there is nothing to resume.
 */
export function ensureResumeSignedMutation(
  path: string = pageResumePath(),
): ResumeHandle | null {
  const intent = loadHeldIntent()
  if (!intent || !pathBasesMatch(intent.path, path)) return null

  if (intent.draftReason) {
    ceremonyDraft = {
      reason: intent.draftReason,
      ...(intent.draftChangeControlId
        ? { changeControlId: intent.draftChangeControlId }
        : {}),
    }
  }

  if (!resumePromise) {
    resumePromise = replaySignedMutation(intent).finally(() => {
      heldIntent = null
    })
  }
  return { intent, promise: resumePromise }
}

/** Replay the mutation through `withReason` so the ceremony opens again (once). */
export async function replaySignedMutation(
  intent: PendingSignedMutation,
): Promise<Response> {
  const method = intent.method.toUpperCase()
  const bodyJson =
    intent.body !== undefined ? JSON.stringify(intent.body) : undefined
  const send = (submission?: ReasonSubmission) =>
    fetch(intent.apiPath, {
      credentials: 'same-origin',
      method,
      headers: {
        Accept: 'application/json',
        ...(bodyJson !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(submission
          ? {
              [REASON_HEADER]: submission.reason,
              [SIGNATURE_HEADER]: submission.signatureId,
              [CHANGE_CONTROL_HEADER]: submission.changeControlId.trim(),
            }
          : {}),
      },
      ...(bodyJson !== undefined ? { body: bodyJson } : {}),
    })
  return withReason(send, {
    method,
    path: intent.apiPath,
    body: intent.body,
    changeSummary: intent.changeSummary,
  })
}

export const SIGNED_MUTATION_COMPLETE_EVENT = 'mice:signed-mutation-complete'

export function dispatchSignedMutationComplete(intent: PendingSignedMutation): void {
  try {
    window.dispatchEvent(
      new CustomEvent(SIGNED_MUTATION_COMPLETE_EVENT, { detail: intent }),
    )
  } catch {
    /* ignore */
  }
}

/**
 * Navigate to step-up/MFA. When `pending` is set, return auto-resumes that mutation
 * (ceremony) so the operator does not click Approve / Grant again.
 */
export function continueToSigningReauth(
  continueUrl: string,
  pending?: Omit<PendingSignedMutation, 'kind' | 'at'> & { at?: number },
): void {
  if (pending) stashPendingSignedMutation(pending)
  window.location.assign(continueUrl)
}

/** @deprecated Prefer ensureResumeSignedMutation — notice banner removed. */
export function stashSigningResumeNotice(path: string = pageResumePath()): void {
  try {
    sessionStorage.setItem(
      SIGNING_RESUME_KEY,
      JSON.stringify({ path, message: '', at: Date.now() }),
    )
  } catch {
    /* ignore */
  }
}

/** @deprecated Prefer ensureResumeSignedMutation. */
export function consumeSigningResumeNotice(
  path: string = pageResumePath(),
): SigningResumeNotice | null {
  try {
    const raw = sessionStorage.getItem(SIGNING_RESUME_KEY)
    sessionStorage.removeItem(SIGNING_RESUME_KEY)
    if (!raw) return null
    const notice = JSON.parse(raw) as SigningResumeNotice
    if (!notice?.path || typeof notice.at !== 'number') return null
    if (Date.now() - notice.at > TTL_MS) return null
    if (!pathBasesMatch(notice.path, path)) return null
    if (!notice.message) return null
    return notice
  } catch {
    return null
  }
}

/** Merge-request signing ceremony interrupted by step-up (panel is React state). */
export const MERGE_SIGN_RESUME_KEY = 'mice.merge-sign.resume'

export type MergeSignResume = {
  kind: 'merge_sign'
  /** Browser path so we only reopen on the same MR page (or list). */
  path: string
  mergeRequestId: string
  at: number
  draftReason?: string
  draftChangeControlId?: string
}

function isMergeSignResume(value: unknown): value is MergeSignResume {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    v.kind === 'merge_sign' &&
    typeof v.path === 'string' &&
    typeof v.mergeRequestId === 'string' &&
    typeof v.at === 'number'
  )
}

/** Stash merge ceremony drafts before navigating to `/auth/reauth`. */
export function stashMergeSignResume(
  intent: Omit<MergeSignResume, 'kind' | 'at'> & { at?: number },
): void {
  try {
    const payload: MergeSignResume = {
      kind: 'merge_sign',
      path: intent.path,
      mergeRequestId: intent.mergeRequestId,
      at: intent.at ?? Date.now(),
      ...(intent.draftReason ? { draftReason: intent.draftReason } : {}),
      ...(intent.draftChangeControlId
        ? { draftChangeControlId: intent.draftChangeControlId }
        : {}),
    }
    sessionStorage.setItem(MERGE_SIGN_RESUME_KEY, JSON.stringify(payload))
  } catch {
    /* private mode / quota — best-effort */
  }
}

/**
 * Read + clear a merge ceremony resume when the path matches.
 * Call from the MR page/list so Approve reopens after step-up.
 */
export function takeMergeSignResume(
  path: string = pageResumePath(),
): MergeSignResume | null {
  try {
    const raw = sessionStorage.getItem(MERGE_SIGN_RESUME_KEY)
    if (!raw) return null
    sessionStorage.removeItem(MERGE_SIGN_RESUME_KEY)
    const parsed = JSON.parse(raw) as unknown
    if (!isMergeSignResume(parsed)) return null
    if (Date.now() - parsed.at > TTL_MS) return null
    if (!pathBasesMatch(parsed.path, path)) return null
    return parsed
  } catch {
    return null
  }
}

/** Test helper: reset module resume state. */
export function resetSigningResumeForTests(): void {
  heldIntent = undefined
  resumePromise = null
  ceremonyDraft = null
  try {
    sessionStorage.removeItem(SIGNING_RESUME_KEY)
    sessionStorage.removeItem(MERGE_SIGN_RESUME_KEY)
  } catch {
    /* ignore */
  }
}
