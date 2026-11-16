import { Box } from 'lucide-react'

/** Shared Mice mark on unauthenticated shells (login, IdP gate) — same Box mark as the homepage topbar. */
export function LoginBrand() {
  return (
    <p className="login-brand">
      <Box className="login-brand-logo brand-mark" size={20} strokeWidth={1.5} aria-hidden="true" />
      <span>MICE</span>
    </p>
  )
}
