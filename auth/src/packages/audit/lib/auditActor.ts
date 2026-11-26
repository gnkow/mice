import type { SessionUser } from '../../authentication/principal.js'
import { canonicalIssuer } from '../../authentication/principal.js'
import type { AuditActor } from './auditTypes.js'

export function actorFromUser(user: SessionUser): AuditActor {
  return {
    sub: user.sub,
    iss: canonicalIssuer(user.iss),
    email: user.email,
    name: user.name,
  }
}

export function extractMessageFromJson(
  body: Record<string, unknown>,
): string | undefined {
  for (const key of ['message', 'commit_message']) {
    const v = body[key]
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 500)
  }
  return undefined
}

export function extractMessageFromForm(form: FormData): string | undefined {
  for (const key of ['message', 'commit_message']) {
    const v = form.get(key)
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 500)
  }
  return undefined
}

export function extractRepoCreateFromJson(
  body: Record<string, unknown>,
): { namespace?: string; repo?: string } {
  const namespace =
    typeof body.namespace === 'string' ? body.namespace : undefined
  const repo = typeof body.name === 'string' ? body.name : undefined
  return { namespace, repo }
}
