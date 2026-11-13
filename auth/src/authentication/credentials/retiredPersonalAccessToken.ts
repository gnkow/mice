/**
 * Personal access tokens are retired (issue 48). Legacy `mice_pat_*` bearers
 * never authenticate; CLI credentials use `mice_cli_*` from device approval.
 */

export const RETIRED_PAT_PREFIX = 'mice_pat_'

/** True when the bearer looks like a retired personal access token. */
export function isRetiredPersonalAccessToken(token: string): boolean {
  return token.trim().startsWith(RETIRED_PAT_PREFIX)
}
