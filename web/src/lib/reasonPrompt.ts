/**
 * Fixed v1 pick-list (must match auth `REASON_CATEGORIES` values).
 * Labels describe which operations belong in each bucket.
 */
export const REASON_CATEGORIES = [
  {
    value: 'data_correction',
    label: 'Data correction',
    hint: 'Amend existing records, metadata, or file content',
  },
  {
    value: 'destructive',
    label: 'Destructive action',
    hint: 'Delete repositories, branches, namespaces, or other data',
  },
  {
    value: 'privileged_settings',
    label: 'Access & settings',
    hint: 'Grants, roles, members, instance or namespace configuration',
  },
  {
    value: 'revocation',
    label: 'Revocation',
    hint: 'Revoke signatures, sessions, or previously granted access',
  },
  {
    value: 'other',
    label: 'Other',
    hint: 'Does not fit the categories above',
  },
] as const

export type ReasonCategoryValue = (typeof REASON_CATEGORIES)[number]['value']

/**
 * Pick the category that best matches the mutation about to be signed.
 * Operators can still change it in the ceremony.
 */
export function suggestReasonCategory(input: {
  method: string
  path: string
  changeSummary?: string
}): ReasonCategoryValue {
  const method = input.method.toUpperCase()
  const path = input.path.toLowerCase()
  const summary = (input.changeSummary ?? '').toLowerCase()
  const hay = `${path} ${summary}`

  if (
    /revok|suspend|\/deny\b/.test(hay) ||
    /\brevoc/.test(hay) ||
    path.includes('/signatures/') && path.includes('revoke')
  ) {
    return 'revocation'
  }
  if (
    method === 'DELETE' ||
    /\bdelete\b|\bdestroy\b|destructive/.test(hay)
  ) {
    return 'destructive'
  }
  if (
    /access-request|\/grants\/|\/instance|seal-key|announcement|permission|\/members|collaborator|approver|\/role|training|group-binding|access-review/.test(
      hay,
    ) ||
    /\bgrant\b|\bapprov|\baccess request|\bsettings\b/.test(summary)
  ) {
    return 'privileged_settings'
  }
  if (/correct|amend|metadata|\/file|\/files|patch|data correction/.test(hay)) {
    return 'data_correction'
  }
  return 'other'
}

export type ReasonSubmission = {
  reason: string
  category: ReasonCategoryValue
  /** Optional; the BFF mints a change-control id when absent. */
  changeControlId?: string
  /** Required for regulated mutations after the signing ceremony. */
  signatureId: string
}

export type ReasonPromptOptions = {
  /** Human-readable description of the mutation about to run. */
  changeSummary: string
  /** Server rejection detail (min length, missing category, etc.). */
  detail: string
  method: string
  path: string
  body?: unknown
}

type Opener = (options: ReasonPromptOptions) => Promise<ReasonSubmission | null>

let opener: Opener | null = null

/** Wired by ReasonPromptProvider in the app shell. */
export function registerReasonOpener(next: Opener | null) {
  opener = next
}

/**
 * Collects category + free-text reason and completes the electronic signature ceremony.
 * Falls back to null when the provider is not mounted (tests / SSR).
 */
export function askReason(options: ReasonPromptOptions): Promise<ReasonSubmission | null> {
  if (!opener) {
    console.error('askReason: ReasonPromptProvider is not mounted')
    return Promise.resolve(null)
  }
  return opener(options)
}

/** Short label for what the HTTP call will change. */
export function summarizeMutation(method: string, path: string): string {
  const m = method.toUpperCase()
  const p = path.split('?')[0] ?? path
  const parts = p.split('/').filter(Boolean)

  if (parts[0] === 'api' && parts[1] === 'repos') {
    const ns = parts[2] ? decodeURIComponent(parts[2]) : undefined
    const repo = parts[3] ? decodeURIComponent(parts[3]) : undefined
    const scope = ns && repo ? `${ns}/${repo}` : ns ?? 'repository'
    if (parts[4] === 'branches') {
      const branch = parts[5] ? decodeURIComponent(parts[5]) : undefined
      if (m === 'DELETE' && branch) return `Delete branch “${branch}” in ${scope}`
      if (m === 'POST') return `Create a branch in ${scope}`
      if (m === 'PUT' && branch) return `Update branch “${branch}” in ${scope}`
    }
    if (parts[4] === 'file' || parts[4] === 'files') {
      const filePath = parts.slice(6).map(decodeURIComponent).join('/') || parts.slice(5).map(decodeURIComponent).join('/')
      if (m === 'DELETE') return `Delete ${filePath || 'a file'} in ${scope}`
      return `Update ${filePath || 'a file'} in ${scope}`
    }
    if (m === 'DELETE' && repo) return `Delete repository ${scope}`
    if (m === 'POST' && !repo) return `Create a repository in ${ns}`
  }

  if (parts[0] === 'auth') {
    if (parts[1] === 'namespaces') {
      const ns = parts[2] ? decodeURIComponent(parts[2]) : undefined
      if (m === 'POST' && !ns) return 'Create a namespace'
      if (m === 'PATCH' && ns && !parts[3]) return `Update settings for namespace “${ns}”`
      if (m === 'DELETE' && ns && !parts[3]) return `Delete namespace “${ns}”`
      if (parts[3] === 'members') return `${m === 'DELETE' ? 'Remove a member from' : 'Change membership in'} namespace “${ns}”`
      if (parts[3] === 'approvers') return `${m === 'DELETE' ? 'Remove an approver from' : 'Assign an approver in'} namespace “${ns}”`
      if (parts[3] === 'repos' && parts[5] === 'approvers') {
        return `${m === 'DELETE' ? 'Remove an approver from' : 'Assign an approver on'} ${ns}/${parts[4]}`
      }
      if (parts[3] === 'repos' && parts[5] === 'collaborators') {
        return `${m === 'DELETE' ? 'Remove a collaborator from' : 'Change collaborators on'} ${ns}/${parts[4]}`
      }
    }
    if (parts[1] === 'signatures' && parts[3] === 'revoke' && parts[2]) {
      return `Revoke signature ${decodeURIComponent(parts[2]).slice(0, 8)}… (affected commits become QC Failed)`
    }
    if (parts[1] === 'admin' && parts[2] === 'seal-keys') {
      return parts[4] === 'emergency'
        ? 'Emergency-rotate the session cookie seal key'
        : 'Rotate the session cookie seal key'
    }
    if (parts[1] === 'instance') return 'Change instance settings or permissions'
    if (parts[1] === 'access-requests') return 'Decide an access request'
  }

  return `${m} ${p}`
}
