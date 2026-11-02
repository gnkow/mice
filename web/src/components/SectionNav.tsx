import { useEffect, useRef, useState, type ComponentType } from 'react'

export type SectionNavItem = {
  id: string
  label: string
  Icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>
  badge?: number
}
export type SectionNavGroup = { title: string; items: SectionNavItem[] }

/** Grouped in-page navigation; highlights the section currently in view. */
export function SectionNav({ label, groups }: { label: string; groups: SectionNavGroup[] }) {
  const navRef = useRef<HTMLElement>(null)
  const ids = groups.flatMap((g) => g.items.map((i) => i.id))
  const key = ids.join('|')
  const [active, setActive] = useState(ids[0] ?? '')

  useEffect(() => {
    // Section elements may mount late (async data), so resolve them at scroll time.
    function onScroll() {
      let current = ''
      for (const id of key.split('|')) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= 140) current = id
      }
      if (current) setActive(current)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [key])

  useEffect(() => {
    const nav = navRef.current
    const link = nav?.querySelector<HTMLAnchorElement>(`a[href="#${CSS.escape(active)}"]`)
    if (!nav || !link) return
    const navRect = nav.getBoundingClientRect()
    const linkRect = link.getBoundingClientRect()
    if (linkRect.top < navRect.top) nav.scrollTop -= navRect.top - linkRect.top + 8
    else if (linkRect.bottom > navRect.bottom) nav.scrollTop += linkRect.bottom - navRect.bottom + 8
  }, [active])

  return (
    <nav className="profile-nav" aria-label={label} ref={navRef}>
      {groups.map((group) => (
        <div key={group.title} className="profile-nav-group">
          <p className="profile-nav-title" id={`${key}-${group.title}`}>{group.title}</p>
          <ul aria-labelledby={`${key}-${group.title}`}>
            {group.items.map(({ id, label: text, Icon, badge }) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  aria-current={active === id ? 'true' : undefined}
                  onClick={(e) => {
                    e.preventDefault()
                    setActive(id)
                    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                >
                  <Icon size={16} aria-hidden="true" />{text}
                  {badge != null && <span className="pill profile-nav-badge">{badge}</span>}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}
