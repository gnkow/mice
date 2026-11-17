import { useState, type MouseEvent } from 'react'
import { Copy as ActionCopy } from 'lucide-react'
import {
  entityIdCopyLabel,
  entityIdTitle,
  type EntityIdKind,
} from '../lib/entityId'

type InlineProps = {
  kind: EntityIdKind
  id: string
  className?: string
}

/**
 * Full entity id with copy control.
 * Entity pages place this under the title; listings place it after the title.
 */
export function EntityIdInline({ kind, id, className }: InlineProps) {
  const [copied, setCopied] = useState(false)

  async function copy(e: MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      className={['entity-id-inline', className].filter(Boolean).join(' ')}
      onClick={(e) => void copy(e)}
      onMouseDown={(e) => e.stopPropagation()}
      title={entityIdTitle(kind, id)}
      aria-label={entityIdCopyLabel(kind, id)}
    >
      <span className="entity-id-inline-value">{id}</span>
      <ActionCopy size={12} aria-hidden="true" className="entity-id-inline-icon" />
      <span className="entity-id-inline-status" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  )
}

export { entityIdTitle }
