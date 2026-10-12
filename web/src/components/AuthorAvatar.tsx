import { initials } from '../lib/initials'

export function AuthorAvatar({ name }: { name: string }) {
  return (
    <span className="avatar-circle" title={name} aria-hidden>
      {initials(name)}
    </span>
  )
}
