/**
 * Personal access tokens are retired (issue 48). Legacy `mice_pat_*` bearers
 * never authenticate; CLI credentials use `mice_cli_*` from device approval.
 */

export const RETIRED_PAT_PREFIX = 'mice_pat_'
export const CLI_CREDENTIAL_PREFIX = 'mice_cli_'

/** Kind of bearer secret presented to credential resolve / refresh. */
export type BearerCredentialKind = 'retired_pat' | 'cli' | 'unknown'

/**
 * Classifies a bearer token by prefix before any DB lookup.
 * Retirement locality lives here so resolve and refresh share one refusal rule.
 */
export function classifyBearerCredential(token: string): BearerCredentialKind {
  const trimmed = token.trim()
  if (trimmed.startsWith(RETIRED_PAT_PREFIX)) return 'retired_pat'
  if (trimmed.startsWith(CLI_CREDENTIAL_PREFIX)) return 'cli'
  return 'unknown'
}

/** True when the bearer looks like a retired personal access token. */
export function isRetiredPersonalAccessToken(token: string): boolean {
  return classifyBearerCredential(token) === 'retired_pat'
}
