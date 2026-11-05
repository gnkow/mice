# Page override — Request Access (`/pending`)

Extends `.sketch/design-brief.md` for the no-access Request Access shell.

## Composition

- Brand → shield icon → one H1 → short lede → form → full-width primary CTA → Sign out secondary
- Request type and roles are **selectable cards** (native radios), not bare radio rows
- Submitted state uses success icon + calm confirmation (no nav escape)

## Form UX (ui-ux-pro-max)

- Focusable error summary at top after failed submit (`role="alert"`, `tabIndex={-1}`)
- Inline field errors for justification and permissions with `aria-describedby`
- Helper text under justification; live selected-count for custom permissions
- Loading/disabled on submit; `aria-busy` while submitting
- Keep Lucide icons; keep MICE tokens (no skill palette)

## Motion

- Subtle panel enter (~320ms); disabled under `prefers-reduced-motion`
