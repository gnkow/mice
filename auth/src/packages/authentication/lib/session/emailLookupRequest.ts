/** Authors (`iss|sub`) accepted on POST /auth/principals/emails. Caps the batch. */
export function parseEmailLookupAuthors(body: unknown, limit = 500): string[] {
  const raw = body && typeof body === 'object' ? (body as { authors?: unknown }).authors : undefined
  const authors = Array.isArray(raw) ? raw.filter((a): a is string => typeof a === 'string') : []
  return authors.slice(0, limit)
}
