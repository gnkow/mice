import { ChevronDown as ActionChevronDown, ChevronUp as ActionChevronUp } from 'lucide-react'
import { useEffect, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadEffectiveMeta, metaParams, metaKey, type EffectiveMeta, type MetaTarget } from '../lib/meta'

const MAX_VISIBLE = 4
const MAX_LABEL_CHARS = 28

type Pill = { key: string; focus: string; text: string; title: string }

function toPills(meta: EffectiveMeta): Pill[] {
  const tags = meta.tags.map((t) => ({
    key: `t:${t.value}`,
    focus: `tag:${t.value}`,
    text: `#${t.value}`,
    title: 'Tag',
  }))
  const labels = Object.entries(meta.labels).map(([k, v]) => ({
    key: `l:${k}`,
    focus: `label:${k}`,
    text: `${k}:${v.value}`,
    title: `${k}=${v.value}`,
  }))
  return [...tags, ...labels]
}

/** Explicit tags and labels as pills for list rows. */
export function MetaPills({
  type,
  id,
  meta: provided,
  scope,
}: {
  type: string
  id: string
  /** Already-loaded metadata (skips the fetch). */
  meta?: EffectiveMeta
  scope?: MetaTarget['scope']
}) {
  const [loaded, setLoaded] = useState<{ key: string; meta: EffectiveMeta | null } | null>(null)
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()
  const scopeKind = scope?.kind
  const scopeRevision = scope?.id
  const cacheKey = metaKey({ type, id, scope })

  useEffect(() => {
    if (provided) return
    let live = true
    const selectedScope = scopeKind && scopeRevision ? { kind: scopeKind, id: scopeRevision } : undefined
    void loadEffectiveMeta({ type, id, scope: selectedScope }).then((meta) => live && setLoaded({ key: cacheKey, meta }))
    return () => {
      live = false
    }
  }, [type, id, provided, scopeKind, scopeRevision, cacheKey])

  const meta = provided ?? (loaded?.key === cacheKey ? loaded.meta : null)
  if (!meta) return null
  const pills = toPills(meta)
  if (pills.length === 0) return null
  const shown = expanded ? pills : pills.slice(0, MAX_VISIBLE)
  const hidden = pills.length - shown.length
  // Spans rather than buttons: buttons nested in a card's <a> don't receive clicks in all browsers.
  const act = (fn: () => void) => ({
    tabIndex: 0,
    onClick: (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      fn()
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      e.stopPropagation()
      fn()
    },
  })

  return (
    <span className="meta-pills" data-testid="meta-pills" aria-label="Metadata">
      {shown.map((p) => (
        <span
          key={p.key}
          role="link"
          className="meta-pill meta-pill-link"
          title={`${p.title} — open metadata`}
          {...act(() => {
            const params = metaParams({ type, id, scope })
            params.set('focus', p.focus)
            navigate(`/meta?${params}`)
          })}
        >
          {p.text.length > MAX_LABEL_CHARS ? `${p.text.slice(0, MAX_LABEL_CHARS - 1)}…` : p.text}
        </span>
      ))}
      {hidden > 0 && (
        <span role="button" className="meta-pill meta-pill-more" {...act(() => setExpanded(true))}>
          <ActionChevronDown size={14} aria-hidden="true" className="button-label-icon" />+{hidden} more
        </span>
      )}
      {expanded && pills.length > MAX_VISIBLE && (
        <span role="button" className="meta-pill meta-pill-more" {...act(() => setExpanded(false))}>
          <ActionChevronUp size={14} aria-hidden="true" className="button-label-icon" />Show less
        </span>
      )}
    </span>
  )
}
