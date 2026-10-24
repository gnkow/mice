import type { SessionUser } from './session.js'

function shouldInjectAuthor(body: Record<string, unknown>): boolean {
  // POST /api/repos uses `name` as the repository name — never treat as author.
  if (
    'namespace' in body &&
    'name' in body &&
    !('email' in body) &&
    !('author' in body) &&
    !('message' in body)
  ) {
    return false
  }
  return (
    'author' in body ||
    'email' in body ||
    'user_name' in body ||
    'user_email' in body ||
    'message' in body ||
    'commit_message' in body ||
    'new_path' in body
  )
}

/** Overwrite oxen author-related fields from the authenticated session. */
export function injectAuthorJson(
  body: Record<string, unknown>,
  user: SessionUser,
): Record<string, unknown> {
  if (!shouldInjectAuthor(body)) return body

  const next = { ...body }
  next.email = user.email
  if ('author' in next || 'message' in next) {
    next.author = user.name
  }
  if ('user_name' in next || 'user_email' in next) {
    next.user_name = user.name
    next.user_email = user.email
  }
  // Branch merge + file move use `name` as author (repo create excluded above).
  if ('name' in next || 'new_path' in next || 'email' in body) {
    next.name = user.name
  }
  return next
}

export function injectAuthorFormData(
  form: FormData,
  user: SessionUser,
): FormData {
  const next = new FormData()
  for (const [key, value] of form.entries()) {
    if (
      key === 'name' ||
      key === 'email' ||
      key === 'author' ||
      key === 'user_name' ||
      key === 'user_email'
    ) {
      continue
    }
    next.append(key, value)
  }
  next.set('name', user.name)
  next.set('email', user.email)
  next.set('author', user.name)
  return next
}

// `name` is excluded: some oxen routes use it for non-author purposes.
const AUTHOR_QUERY_PARAMS = new Set([
  'author',
  'author_name',
  'author_email',
  'committer',
  'committer_name',
  'committer_email',
  'email',
  'user_name',
  'user_email',
])

/** True when the query string carries client-chosen author fields. */
export function hasAuthorQueryParam(params: URLSearchParams): boolean {
  for (const key of params.keys()) {
    if (AUTHOR_QUERY_PARAMS.has(key.toLowerCase())) return true
  }
  return false
}
