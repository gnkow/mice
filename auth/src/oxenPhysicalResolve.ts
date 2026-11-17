import {
  createOwnedRepository,
  ensureRepository,
  readRepository,
  readRepositoryById,
} from './repositoryStore.js'
import { namespaceIdByName, namespaceNameById } from './authzRepository.js'
import { ensureNamespaceForCreate, getNamespace } from './authzNamespaceStore.js'
import { decideInstanceAction } from './authz.js'
import { userKey } from './authzTypes.js'
import type { SessionUser } from './authentication/index.js'
import type { DisplayRepoRef, PhysicalRepoRef } from './oxenPhysicalKeys.js'
import { isPhysicalOxenKey } from './oxenPhysicalKeys.js'

export async function resolveNamespaceId(displayOrId: string): Promise<string | null> {
  if (isPhysicalOxenKey(displayOrId)) {
    const name = await namespaceNameById(displayOrId)
    return name ? displayOrId : null
  }
  return namespaceIdByName(displayOrId)
}

/**
 * Map client path segments to oxen physical keys.
 * Never mint AuthZ rows whose *names* are UUIDs — that traps list leakage into a dead end.
 */
export async function resolvePhysicalRepo(
  displayNs: string,
  displayRepo: string,
): Promise<PhysicalRepoRef | null> {
  if (isPhysicalOxenKey(displayRepo)) {
    const byId = await readRepositoryById(displayRepo)
    if (byId) {
      if (
        displayNs === byId.namespace ||
        displayNs === byId.namespaceId ||
        (isPhysicalOxenKey(displayNs) && displayNs === byId.namespaceId)
      ) {
        return { namespaceId: byId.namespaceId, repositoryId: byId.id }
      }
      return null
    }
    // Both segments already physical and unknown to AuthZ: pass through to oxen.
    if (isPhysicalOxenKey(displayNs)) {
      return { namespaceId: displayNs, repositoryId: displayRepo }
    }
    return null
  }

  const record = await readRepository(displayNs, displayRepo)
  if (record) return { namespaceId: record.namespaceId, repositoryId: record.id }
  // Mint on first touch for real display names only (legacy oxen → AuthZ bridge).
  if (isPhysicalOxenKey(displayNs)) return null
  const ensured = await ensureRepository(displayNs, displayRepo)
  if (!ensured) return null
  return { namespaceId: ensured.namespaceId, repositoryId: ensured.id }
}

export async function displayNamespaceName(namespaceId: string): Promise<string | null> {
  return namespaceNameById(namespaceId)
}

export async function displayRepoRef(
  namespaceId: string,
  repositoryId: string,
): Promise<DisplayRepoRef | null> {
  const record = await readRepositoryById(repositoryId)
  if (!record || record.namespaceId !== namespaceId) return null
  // Corrupt rows (name = physical id) must not be served as display names.
  if (isPhysicalOxenKey(record.name)) return null
  return { namespace: record.namespace, repo: record.name }
}

/**
 * Mint AuthZ namespace + owned repository for a display create, returning physical keys
 * to send to oxen. Display names stay on the AuthZ row.
 */
export async function preparePhysicalRepoCreate(
  user: SessionUser,
  displayNamespace: string,
  displayRepo: string,
): Promise<PhysicalRepoRef | null> {
  if (isPhysicalOxenKey(displayNamespace) || isPhysicalOxenKey(displayRepo)) return null
  if ((await decideInstanceAction(user, 'namespace.create')).allow) {
    await ensureNamespaceForCreate(user, displayNamespace, 'none')
  }
  if (!(await getNamespace(displayNamespace))) return null
  const record = await createOwnedRepository(displayNamespace, displayRepo, userKey(user))
  if (!record) return null
  return { namespaceId: record.namespaceId, repositoryId: record.id }
}
