import { VisibilityIcon, visibilityLabel } from './icons'

type Props = {
  visibility?: 'local' | 'private' | 'public'
  className?: string
  title?: string
  /** Icon only — used in breadcrumb (Hub lock/eye without text). */
  iconOnly?: boolean
}

export function VisibilityPill({
  visibility = 'local',
  className = '',
  title = 'This oxen-server has no visibility ACL',
  iconOnly = false,
}: Props) {
  const label = visibilityLabel(visibility)
  if (iconOnly) {
    return (
      <span
        className={`visibility-icon-only visibility-${visibility} ${className}`.trim()}
        title={title}
        aria-label={label}
      >
        <VisibilityIcon visibility={visibility} size={14} />
      </span>
    )
  }
  return (
    <span
      className={`visibility-pill visibility-${visibility} ${className}`.trim()}
      title={title}
    >
      <VisibilityIcon visibility={visibility} size={12} />
      {label}
    </span>
  )
}
