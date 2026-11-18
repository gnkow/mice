import { GroupRef } from './GroupRef'

export type GroupPrincipalLabelProps = {
  group: string
  name?: string
  /** Compact layout for nested lists (e.g. new-repo collaborators). */
  inline?: boolean
}

/**
 * IdP group principal in member/collaborator lists — same chip pattern as UserRef
 * (group icon + name; click opens GroupInfo).
 */
export function GroupPrincipalLabel({
  group,
  name,
  inline = false,
}: GroupPrincipalLabelProps) {
  return (
    <GroupRef
      bindingKey={group}
      displayName={name}
      className={inline ? 'group-principal-inline-ref' : undefined}
    />
  )
}
