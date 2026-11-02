import type { SessionUser } from './session/session.js'
import { canonicalIssuer } from './session/principal.js'

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
    'author_name' in body ||
    'author_email' in body ||
    'committer' in body ||
    'committer_name' in body ||
    'committer_email' in body ||
    'message' in body ||
    'commit_message' in body ||
    'new_path' in body
  )
}

const NAME_KEYS = ['author', 'author_name', 'committer', 'committer_name', 'user_name']
const EMAIL_KEYS = ['email', 'author_email', 'committer_email', 'user_email']

function commitAuthor(user: SessionUser): string {
  return `${canonicalIssuer(user.iss)}|${user.sub}`
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Overwrite author fields in nested objects and arrays. `name` is only an
 * author when its object also carries an email field.
 */
function overwriteNestedAuthors(value: unknown, user: SessionUser): unknown {
  if (Array.isArray(value)) return value.map((v) => overwriteNestedAuthors(v, user))
  if (!isPlainObject(value)) return value
  const hasEmail = EMAIL_KEYS.some((k) => k in value)
  const next: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) {
    if (EMAIL_KEYS.includes(key)) next[key] = user.email
    else if (NAME_KEYS.includes(key) && !isPlainObject(v)) next[key] = commitAuthor(user)
    else if (key === 'name' && hasEmail) next[key] = commitAuthor(user)
    else next[key] = overwriteNestedAuthors(v, user)
  }
  return next
}

/** Overwrite oxen author-related fields from the authenticated session. */
export function injectAuthorJson(
  body: Record<string, unknown>,
  user: SessionUser,
): Record<string, unknown> {
  if (!shouldInjectAuthor(body)) return overwriteNestedAuthors(body, user) as Record<string, unknown>

  const flat = { ...body }
  for (const [key, v] of Object.entries(flat)) {
    if (isPlainObject(v) || Array.isArray(v)) flat[key] = overwriteNestedAuthors(v, user)
  }
  const next = flat
  for (const k of ['author_name', 'committer', 'committer_name']) {
    if (k in next && !isPlainObject(next[k])) next[k] = commitAuthor(user)
  }
  for (const k of ['author_email', 'committer_email']) {
    if (k in next) next[k] = user.email
  }
  next.email = user.email
  if ('author' in next || 'message' in next) {
    next.author = commitAuthor(user)
  }
  if ('user_name' in next || 'user_email' in next) {
    next.user_name = commitAuthor(user)
    next.user_email = user.email
  }
  // Branch merge + file move use `name` as author (repo create excluded above).
  if ('name' in next || 'new_path' in next || 'email' in body) {
    next.name = commitAuthor(user)
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
  next.set('name', commitAuthor(user))
  next.set('email', user.email)
  next.set('author', commitAuthor(user))
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

/**
 * Author-free binary write routes (ADR 0001). Octet-stream/gzip bodies are only proxied here;
 * a new oxen write route stays unproxyable until it is classified and listed.
 */
const AUTHOR_FREE_BINARY_ROUTES: Array<{ method: string; path: RegExp }> = [
  { method: 'PUT', path: /^\/api\/repos\/[^/]+\/[^/]+\/versions\/[^/]+\/chunks$/ },
  { method: 'QUERY', path: /^\/api\/repos\/[^/]+\/[^/]+\/versions$/ },
]

export function isAuthorFreeBinaryRoute(method: string, pathname: string): boolean {
  const m = method.toUpperCase()
  return AUTHOR_FREE_BINARY_ROUTES.some((r) => r.method === m && r.path.test(pathname))
}
