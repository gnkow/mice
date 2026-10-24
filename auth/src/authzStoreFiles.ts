import type { SessionUser } from './session.js'
import { matchesIdentityEntry } from './principal.js'
import { join } from 'node:path'
import { env } from './env.js'
import { readJsonFile, writeJsonFile } from './jsonStore.js'
import { normalizeGroup, userKey, type BasePermission, type CollaboratorRoleRef, type InstancePermission, type MemberRoleRef } from './authzTypes.js'

export type InstanceStore = {
  version: 1
  /** When true (or AUTHZ_ENFORCE=true), hard gate + repo checks apply. */
  enforce: boolean
  admins: string[] // userKey
  permissions: Record<string, InstancePermission[]> // userKey → perms
  /** Phase 3: userKeys who completed training / GxP onboarding. */
  training?: string[]
}

export type NamespacesStore = {
  version: 1
  namespaces: Record<
    string,
    {
      basePermission: BasePermission
      membersCanCreateRepos: boolean
      createdAt: string
      createdBy: string
    }
  >
}

export type MembersStore = {
  version: 1 | 2
  /** namespace → userKey → role (predefined or custom id) */
  members: Record<string, Record<string, MemberRoleRef>>
  /** namespace → groupKey → role (v2) */
  groupMembers?: Record<string, Record<string, MemberRoleRef>>
}

export type CollaboratorsStore = {
  version: 1 | 2
  /** `${ns}/${repo}` → userKey → role (predefined or custom id) */
  collaborators: Record<string, Record<string, CollaboratorRoleRef>>
  /** `${ns}/${repo}` → groupKey → role (v2) */
  groupCollaborators?: Record<string, Record<string, CollaboratorRoleRef>>
}

export function instancePath() {
  return join(env.dataDir, 'instance-admins.json')
}

export function namespacesPath() {
  return join(env.dataDir, 'namespaces.json')
}

export function membersPath() {
  return join(env.dataDir, 'namespace-members.json')
}

export function collaboratorsPath() {
  return join(env.dataDir, 'repo-collaborators.json')
}

export function emptyInstance(): InstanceStore {
  return { version: 1, enforce: false, admins: [], permissions: {}, training: [] }
}

export function emptyNamespaces(): NamespacesStore {
  return { version: 1, namespaces: {} }
}

export function emptyMembers(): MembersStore {
  return { version: 2, members: {}, groupMembers: {} }
}

export function emptyCollaborators(): CollaboratorsStore {
  return { version: 2, collaborators: {}, groupCollaborators: {} }
}

export function readInstance(): InstanceStore {
  const s = readJsonFile(instancePath(), emptyInstance())
  if (!s || s.version !== 1) return emptyInstance()
  return {
    version: 1,
    enforce: Boolean(s.enforce),
    admins: Array.isArray(s.admins) ? s.admins : [],
    permissions:
      s.permissions && typeof s.permissions === 'object' ? s.permissions : {},
    training: Array.isArray(s.training) ? s.training : [],
  }
}

export function writeInstance(s: InstanceStore): void {
  writeJsonFile(instancePath(), s)
}

export function readNamespaces(): NamespacesStore {
  const s = readJsonFile(namespacesPath(), emptyNamespaces())
  if (!s || s.version !== 1 || !s.namespaces) return emptyNamespaces()
  return s
}

export function writeNamespaces(s: NamespacesStore): void {
  writeJsonFile(namespacesPath(), s)
}

export function readMembers(): MembersStore {
  const s = readJsonFile(membersPath(), emptyMembers())
  if (!s || (s.version !== 1 && s.version !== 2) || !s.members) {
    return emptyMembers()
  }
  return {
    version: 2,
    members: s.members,
    groupMembers:
      s.groupMembers && typeof s.groupMembers === 'object'
        ? s.groupMembers
        : {},
  }
}

export function writeMembers(s: MembersStore): void {
  writeJsonFile(membersPath(), {
    version: 2,
    members: s.members,
    groupMembers: s.groupMembers ?? {},
  })
}

export function readCollaborators(): CollaboratorsStore {
  const s = readJsonFile(collaboratorsPath(), emptyCollaborators())
  if (!s || (s.version !== 1 && s.version !== 2) || !s.collaborators) {
    return emptyCollaborators()
  }
  return {
    version: 2,
    collaborators: s.collaborators,
    groupCollaborators:
      s.groupCollaborators && typeof s.groupCollaborators === 'object'
        ? s.groupCollaborators
        : {},
  }
}

export function writeCollaborators(s: CollaboratorsStore): void {
  writeJsonFile(collaboratorsPath(), {
    version: 2,
    collaborators: s.collaborators,
    groupCollaborators: s.groupCollaborators ?? {},
  })
}

export function countNamespaceOwnersIn(store: MembersStore, ns: string): number {
  const users = Object.values(store.members[ns] ?? {}).filter(
    (r) => r === 'owner',
  ).length
  const groups = Object.values(store.groupMembers?.[ns] ?? {}).filter(
    (r) => r === 'owner',
  ).length
  return users + groups
}

export function sessionGroups(user: { groups?: string[] }): string[] {
  return (user.groups ?? []).map(normalizeGroup).filter(Boolean)
}

export function repoKey(ns: string, repo: string): string {
  return `${ns}/${repo}`
}

export function bootstrapAllowlist(): string[] {
  return env.authzBootstrapAdmins
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function matchesBootstrap(user: SessionUser): boolean {
  return bootstrapAllowlist().some((entry) => matchesIdentityEntry(entry, user))
}
