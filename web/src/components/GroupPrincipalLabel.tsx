import type { GroupBindingMode } from '../lib/authzApi'

export type GroupPrincipalLabelProps = {
  group: string
  name?: string
  bindingMode?: GroupBindingMode
  /** Compact inline layout for nested lists (e.g. new-repo collaborators). */
  inline?: boolean
}

function splitBindingKey(group: string): { objectId: string; issuer?: string } {
  const i = group.indexOf('|')
  if (i > 0 && i < group.length - 1) {
    return { issuer: group.slice(0, i), objectId: group.slice(i + 1) }
  }
  return { objectId: group }
}

/**
 * Prefer cached IdP display names; keep the immutable object id visible as
 * secondary text so grants stay auditable after renames.
 */
export function GroupPrincipalLabel({
  group,
  name,
  bindingMode,
  inline = false,
}: GroupPrincipalLabelProps) {
  const { objectId, issuer } = splitBindingKey(group)
  const display = (name?.trim() || objectId).trim()
  const showId = Boolean(name?.trim() && name.trim() !== objectId)
  const modeLabel =
    bindingMode === 'name-based'
      ? 'Name-based binding'
      : bindingMode === 'id-based'
        ? 'ID-based binding'
        : undefined
  const title = [
    display,
    showId ? `object id ${objectId}` : null,
    issuer ? `issuer ${issuer}` : null,
    modeLabel,
  ]
    .filter(Boolean)
    .join(' · ')

  const primary = (
    <span className="group-principal-name" title={title}>
      {display}
    </span>
  )

  const meta = (
    <span className="muted small group-principal-meta">
      {showId ? (
        <>
          <code className="group-principal-id">{objectId}</code>
          {modeLabel ? <span className="group-principal-sep">·</span> : null}
        </>
      ) : null}
      {modeLabel ? (
        <span
          className={
            bindingMode === 'name-based'
              ? 'group-binding-chip group-binding-chip-warn'
              : 'group-binding-chip'
          }
        >
          {modeLabel}
        </span>
      ) : showId ? null : (
        <span>IdP group</span>
      )}
    </span>
  )

  if (inline) {
    return (
      <span className="group-principal group-principal-inline" title={title}>
        {primary}
        <span className="group-principal-sep">·</span>
        {meta}
      </span>
    )
  }

  return (
    <div className="group-principal" title={title}>
      {primary}
      {meta}
    </div>
  )
}
