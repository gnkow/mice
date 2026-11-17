/** Stable entity kinds that show AuthZ or resource IDs in the UI. */
export type EntityIdKind =
  | 'repository'
  | 'namespace'
  | 'workspace'
  | 'job'
  | 'session'

const LABELS: Record<EntityIdKind, string> = {
  repository: 'Repository ID',
  namespace: 'Namespace ID',
  workspace: 'Workspace ID',
  job: 'Job ID',
  session: 'Session ID',
}

/** Human label for an entity kind (“Repository ID”). */
export function entityIdLabel(kind: EntityIdKind): string {
  return LABELS[kind]
}

/** Native `title` / tooltip text that discloses a full entity id. */
export function entityIdTitle(kind: EntityIdKind, id: string): string {
  return `${LABELS[kind]} ${id}`
}

/** Accessible name for a copy-control that reveals an entity id. */
export function entityIdCopyLabel(kind: EntityIdKind, id: string): string {
  return `${LABELS[kind]} ${id}. Click to copy.`
}
