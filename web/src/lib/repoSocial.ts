/** Browser-local Star. oxen-server has no social graph. */

export const REPO_SOCIAL_EVENT = 'boxen:repo-social'

type Social = {
  watch: boolean
  star: boolean
}

const KEY = 'boxen.repoSocial'

function readAll(): Record<string, Social> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Social>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function id(namespace: string, repo: string): string {
  return `${namespace}/${repo}`
}

export function loadRepoSocial(namespace: string, repo: string): Social {
  return readAll()[id(namespace, repo)] ?? { watch: false, star: false }
}

export function saveRepoSocial(
  namespace: string,
  repo: string,
  next: Social,
): void {
  const all = readAll()
  all[id(namespace, repo)] = next
  localStorage.setItem(KEY, JSON.stringify(all))
  window.dispatchEvent(
    new CustomEvent(REPO_SOCIAL_EVENT, {
      detail: { namespace, repo, social: next },
    }),
  )
}
