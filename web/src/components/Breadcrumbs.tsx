import { Link } from 'react-router-dom'

export type Crumb = {
  label: string
  to?: string
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  if (items.length === 0) return null
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${item.label}-${i}`}>
              {!last && item.to ? (
                <Link to={item.to}>{item.label}</Link>
              ) : (
                <span aria-current={last ? 'page' : undefined}>{item.label}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export function namespaceCrumbs(namespace: string): Crumb[] {
  return [
    { label: namespace, to: `/n/${encodeURIComponent(namespace)}` },
  ]
}

export function repoCrumbs(
  namespace: string,
  repo: string,
  ...extra: Crumb[]
): Crumb[] {
  return [
    ...namespaceCrumbs(namespace),
    {
      label: repo,
      to: `/n/${encodeURIComponent(namespace)}/r/${encodeURIComponent(repo)}`,
    },
    ...extra,
  ]
}
