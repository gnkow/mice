/**
 * Operator-facing copy for AuthZ / proxy denial strings.
 * Collaborator seats are the source of truth for repository data access.
 */

export type AccessErrorView = {
  /** Role / permission name for display, e.g. "Read". */
  permission: string
  /** Short headline. */
  title: string
  /** Guidance: who can grant access and what is needed. */
  detail: string
}

export type AccessErrorOptions = {
  /** What the user was trying to do, e.g. "view data", "view commits". */
  purpose?: string
}

const REPO_ROLE_RE = /^Requires repo role\s+(\w+)\s*$/i
const REPO_ACCESS_RE = /^Requires repository\s+(\w+)\s*$/i
const JOB_ACTION_RE =
  /^job\.(read|submit|cancel|complete)\s+requires repository\s+(\w+)(?:\s+or\s+(\w+))?\s*$/i
const LINEAGE_RE = /^Requires lineage_(read|rebuild) on repository\s*$/i
const SEAT_RE =
  /^You need a collaborator seat with at least (\w+) access(?: on this repository)?(?: to (.+?))?\.?$/i
const SEAT_TITLE_RE = /^(\w+) access required(?: to (.+))?\.?$/i

const ROLE_LABEL: Record<string, string> = {
  read: 'Read',
  triage: 'Triage',
  write: 'Write',
  maintain: 'Maintain',
  admin: 'Admin',
}

function roleLabel(role: string): string {
  return ROLE_LABEL[role.toLowerCase()] ?? role
}

function grantGuidance(permission: string): string {
  return `Only collaborators can access this repository’s data. Ask a namespace Owner, or a collaborator with Maintain or Admin, to grant you the ${permission} role (or higher).`
}

function forRepoRole(role: string, purpose?: string): AccessErrorView {
  const permission = roleLabel(role)
  const action = purpose?.trim()
  return {
    permission,
    title: action
      ? `${permission} access required to ${action}`
      : `${permission} access required`,
    detail: grantGuidance(permission),
  }
}

/**
 * Structured access denial for UI. Returns null when the string is not an AuthZ denial.
 */
export function describeAccessError(
  error: string | null | undefined,
  options?: AccessErrorOptions,
): AccessErrorView | null {
  const raw = (error ?? '').trim()
  if (!raw) return null
  const fallbackPurpose = options?.purpose?.trim()

  const roleMatch = raw.match(REPO_ROLE_RE)
  if (roleMatch) return forRepoRole(roleMatch[1]!, fallbackPurpose ?? 'view data')

  const accessMatch = raw.match(REPO_ACCESS_RE)
  if (accessMatch) return forRepoRole(accessMatch[1]!, fallbackPurpose ?? 'view data')

  const seatMatch = raw.match(SEAT_RE)
  if (seatMatch) {
    return forRepoRole(
      seatMatch[1]!,
      seatMatch[2]?.trim() || fallbackPurpose || 'view data',
    )
  }

  const titleMatch = raw.match(SEAT_TITLE_RE)
  if (titleMatch && ROLE_LABEL[titleMatch[1]!.toLowerCase()]) {
    return forRepoRole(
      titleMatch[1]!,
      titleMatch[2]?.trim() || fallbackPurpose || 'view data',
    )
  }

  const jobMatch = raw.match(JOB_ACTION_RE)
  if (jobMatch) {
    const action = jobMatch[1]!
    const role = jobMatch[2]!
    const fine = jobMatch[3]
    const purpose =
      action === 'read'
        ? 'view jobs'
        : action === 'submit'
          ? 'submit jobs'
          : action === 'cancel'
            ? 'cancel jobs'
            : 'complete jobs'
    const view = forRepoRole(role, purpose)
    if (fine) {
      return {
        ...view,
        detail: `${view.detail} A custom role with the ${fine} permission also works.`,
      }
    }
    return view
  }

  const lineageMatch = raw.match(LINEAGE_RE)
  if (lineageMatch) {
    return lineageMatch[1] === 'rebuild'
      ? forRepoRole('admin', 'rebuild lineage')
      : forRepoRole('read', 'view lineage')
  }

  if (/^Forbidden$/i.test(raw)) {
    return {
      permission: 'Access',
      title: fallbackPurpose
        ? `Access denied to ${fallbackPurpose}`
        : 'Access denied',
      detail:
        'You do not have permission for this action. If this is a repository, ask a namespace Owner or a Maintain/Admin collaborator to grant the role you need.',
    }
  }

  if (/^Forbidden:\s*cannot edit metadata/i.test(raw)) {
    return forRepoRole('write', 'edit metadata')
  }

  if (/You need a collaborator seat/i.test(raw) || /access required/i.test(raw)) {
    return {
      permission: 'Access',
      title: raw.replace(/\.\s*$/, ''),
      detail: grantGuidance('required'),
    }
  }

  return null
}

/**
 * True when retrying will not help (permission / AuthZ denial).
 */
export function isAccessDenial(error: string | null | undefined): boolean {
  return describeAccessError(error) != null
}

/**
 * Single-string form for compact surfaces (cards, plain alerts).
 */
export function formatAccessError(
  error: string | null | undefined,
  options?: AccessErrorOptions,
): string {
  const view = describeAccessError(error, options)
  if (view) return `${view.title}. ${view.detail}`
  const raw = (error ?? '').trim()
  return raw || 'Something went wrong'
}
