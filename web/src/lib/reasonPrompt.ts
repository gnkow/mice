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

/** Short field hint under change-control id. */
export const CHANGE_CONTROL_ID_HINT = 'e.g. CC-YYYYMMDD-xxxxxxxx · must be unique'

/** Short permanence / MFA / length note under the reason field. */
export const CEREMONY_NOTICE =
  'Kept permanently. MFA required. At least 10 characters.'

/** Mirrors auth `CHANGE_CONTROL_ID_PATTERN`. */
export const CHANGE_CONTROL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{2,127}$/

/** Client-side suggestion matching server `allocateChangeControlId`. */
export function suggestChangeControlId(now = new Date()): string {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `CC-${y}${m}${d}-${suffix}`
}

export function isValidChangeControlId(id: string): boolean {
  return CHANGE_CONTROL_ID_PATTERN.test(id.trim())
}

/**
 * Pick the category that best matches the mutation about to be signed.
 * Sent to the BFF automatically; no longer shown in the ceremony UI.
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
  /** Operator-supplied QMS id; claimed uniquely when the signature is recorded. */
  changeControlId: string
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
 * Collects free-text reason + change-control id and completes the electronic signature ceremony.
 * Falls back to null when the provider is not mounted (tests / SSR).
 */
export function askReason(options: ReasonPromptOptions): Promise<ReasonSubmission | null> {
  if (!opener) {
    console.error('askReason: ReasonPromptProvider is not mounted')
    return Promise.resolve(null)
  }
  return opener(options)
}

function pathSeg(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function bodyRecord(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null
}

function bodyString(body: unknown, key: string): string | undefined {
  const value = bodyRecord(body)?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Short human label for what the signed HTTP call will change. */
export function summarizeMutation(
  method: string,
  path: string,
  body?: unknown,
): string {
  const m = method.toUpperCase()
  const p = path.split('?')[0] ?? path
  const parts = p.split('/').filter(Boolean)
  const root = parts[0]

  if ((root === 'api' || root === 'oxen') && parts[1] === 'repos') {
    const ns = pathSeg(parts[2])
    const repo = pathSeg(parts[3])
    const scope = ns && repo ? `${ns}/${repo}` : ns ?? 'repository'
    if (parts[4] === 'branches') {
      const branch =
        pathSeg(parts[5]) ||
        bodyString(body, 'branch_name') ||
        bodyString(body, 'name')
      if (m === 'DELETE' && branch) return `Delete branch “${branch}” in ${scope}`
      if (m === 'POST') {
        return branch
          ? `Create branch “${branch}” in ${scope}`
          : `Create a branch in ${scope}`
      }
      if (m === 'PUT' && branch) return `Update branch “${branch}” in ${scope}`
    }
    if (parts[4] === 'file' || parts[4] === 'files') {
      const filePath =
        parts
          .slice(6)
          .map((s) => pathSeg(s) ?? s)
          .join('/') ||
        parts
          .slice(5)
          .map((s) => pathSeg(s) ?? s)
          .join('/')
      if (m === 'DELETE') return `Delete ${filePath || 'a file'} in ${scope}`
      return `Update ${filePath || 'a file'} in ${scope}`
    }
    if (parts[4] === 'commits' || parts[4] === 'commit') {
      return `Publish a commit on ${scope}`
    }
    if (parts[4] === 'merge') {
      return `Merge into a branch on ${scope}`
    }
    if (m === 'DELETE' && repo) return `Delete repository ${scope}`
    if (m === 'PATCH' && repo) {
      const next = bodyString(body, 'repo_name') || bodyString(body, 'name')
      return next && next !== repo
        ? `Rename repository ${scope} → ${next}`
        : `Update repository ${scope}`
    }
    if (m === 'POST' && !repo) {
      const name = bodyString(body, 'name') || bodyString(body, 'repo_name')
      return name
        ? `Create repository “${name}” in ${ns}`
        : `Create a repository in ${ns}`
    }
  }

  if (root === 'auth') {
    if (parts[1] === 'namespaces') {
      const ns = pathSeg(parts[2])
      if (m === 'POST' && !ns) {
        const name = bodyString(body, 'name')
        return name ? `Create namespace “${name}”` : 'Create a namespace'
      }
      if (ns && !parts[3]) {
        if (m === 'DELETE') return `Delete namespace “${ns}”`
        if (m === 'PATCH') {
          const next = bodyString(body, 'name')
          if (next && next !== ns) return `Rename namespace “${ns}” → “${next}”`
          return `Update settings for namespace “${ns}”`
        }
      }
      if (parts[3] === 'members') {
        return m === 'DELETE'
          ? `Remove a member from namespace “${ns}”`
          : `Change membership in namespace “${ns}”`
      }
      if (parts[3] === 'approvers') {
        return m === 'DELETE'
          ? `Remove an approver from namespace “${ns}”`
          : `Assign an approver in namespace “${ns}”`
      }
      if (parts[3] === 'repos') {
        const repo = pathSeg(parts[4])
        const scope = ns && repo ? `${ns}/${repo}` : ns ?? 'repository'
        if (!parts[5] && m === 'PATCH' && repo) {
          const next = bodyString(body, 'name')
          return next && next !== repo
            ? `Rename repository ${scope} → ${next}`
            : `Update repository ${scope}`
        }
        if (parts[5] === 'approvers') {
          return m === 'DELETE'
            ? `Remove an approver from ${scope}`
            : `Assign an approver on ${scope}`
        }
        if (parts[5] === 'collaborators') {
          return m === 'DELETE'
            ? `Remove a collaborator from ${scope}`
            : `Change collaborators on ${scope}`
        }
      }
      if (parts[3] === 'custom-roles') {
        const kind = parts[4] === 'repo' ? 'repository' : 'namespace'
        const roleName = bodyString(body, 'name')
        if (m === 'POST') {
          return roleName
            ? `Create ${kind} role “${roleName}” in “${ns}”`
            : `Create a ${kind} role in “${ns}”`
        }
        if (m === 'PATCH') {
          return roleName
            ? `Update ${kind} role “${roleName}” in “${ns}”`
            : `Update a ${kind} role in “${ns}”`
        }
        if (m === 'DELETE') return `Delete a ${kind} role in “${ns}”`
      }
    }
    if (parts[1] === 'signatures' && parts[3] === 'revoke' && parts[2]) {
      return `Revoke signature ${pathSeg(parts[2])!.slice(0, 8)}… (affected commits become QC Failed)`
    }
    if (parts[1] === 'announcements') {
      const title = bodyString(body, 'title')
      if (m === 'POST') {
        return title ? `Publish announcement “${title}”` : 'Publish an announcement'
      }
      if (m === 'PATCH') {
        return title ? `Update announcement “${title}”` : 'Update an announcement'
      }
      if (m === 'DELETE') return 'Delete an announcement'
    }
    if (parts[1] === 'admin') {
      if (parts[2] === 'seal-keys') {
        return parts[4] === 'emergency'
          ? 'Emergency-rotate the session cookie seal key'
          : 'Rotate the session cookie seal key'
      }
      if (parts[2] === 'mice-suspension') {
        return parts[3] === 'lift'
          ? 'Lift Mice suspension for a principal'
          : 'Set Mice suspension for a principal'
      }
      if (parts[2] === 'restore-test') return 'Record a restore-test pass'
      if (parts[2] === 'revoke') return 'Revoke all sessions for a principal'
      if (parts[2] === 'suspend') {
        return parts[4] === 'confirm'
          ? 'Confirm suspension of a principal'
          : 'Suspend a principal'
      }
      if (parts[2] === 're-enable') return 'Re-enable a disabled principal'
      if (parts[2] === 'idp-drift') {
        return parts[3] === 'baseline'
          ? 'Update IdP drift baseline'
          : 'Run IdP drift check'
      }
      if (parts[2] === 'access-review') {
        if (parts[3] === 'generate') return 'Generate an access review'
        if (parts[3] === 'sign') return 'Sign an access review'
        return 'Update access review'
      }
      if (parts[2] === 'idp-baseline') return 'Check IdP baseline'
    }
    if (parts[1] === 'instance') {
      if (parts[2] === 'permissions') return 'Change instance permissions'
      if (parts[2] === 'revoke-sessions') return 'Revoke sessions for a principal'
      if (parts[2] === 'group-binding') {
        return parts[3] === 'check'
          ? 'Check IdP group-binding mode'
          : 'Change IdP group-binding settings'
      }
      return 'Change instance settings'
    }
    if (parts[1] === 'grants') {
      if (parts[2] === 'role') return 'Grant or change a formal role'
      if (parts[2] === 'permissions') return 'Grant custom permissions'
      return 'Change access grants'
    }
    if (parts[1] === 'access-requests') {
      if (!parts[2] && m === 'POST') return 'Submit an access request'
      const decision = bodyString(body, 'decision') || bodyString(body, 'action')
      if (decision) return `${decision[0]!.toUpperCase()}${decision.slice(1)} an access request`
      return 'Decide an access request'
    }
    if (parts[1] === 'meta') {
      if (m === 'DELETE') return 'Delete metadata'
      return 'Update metadata'
    }
    if (parts[1] === 'lineage' && parts[2] === 'rebuild') {
      const ns = bodyString(body, 'namespace')
      const repo = bodyString(body, 'repo')
      return ns && repo
        ? `Rebuild lineage for ${ns}/${repo}`
        : 'Rebuild lineage'
    }
    if (parts[1] === 'audit' && parts[2] === 'acknowledge') {
      return 'Acknowledge an audit outage'
    }
    if (parts[1] === 'merge-requests') {
      if (parts[3] === 'complete') return 'Complete a signed merge'
      return 'Update a merge request'
    }
  }

  return `${m} ${p}`
}
